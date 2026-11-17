const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

async function saveScreenshot(page, label = '') {
    if (!page) return null;
    try {
        const logDir = path.join(__dirname, 'log');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeLabel = String(label)
            .replace(/[^a-zA-Z0-9_-]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '')
            .slice(0, 40);
        const fileName = safeLabel ? `error-${timestamp}-${safeLabel}.png` : `error-${timestamp}.png`;
        const filePath = path.join(logDir, fileName);
        await page.screenshot({ path: filePath, fullPage: true });
        return filePath;
    } catch (screenshotErr) {
        console.error('Failed to save error screenshot:', screenshotErr.message);
        return null;
    }
}

async function findPriceSelector(url, targetPrice) {
    console.log(`Processing request for: ${url}`);

    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080'
        ]
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        const rawUa = await browser.userAgent();
        await page.setUserAgent(rawUa.replace('HeadlessChrome', 'Chrome'));

        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        try {
            await page.waitForNetworkIdle({ idleTime: 1000, timeout: 8000 });
        } catch (_) {}
        await new Promise(r => setTimeout(r, 2000));

        const selector = await page.evaluate((target) => {
            const ldScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
            let hasJsonLdMatch = false;
            for (const script of ldScripts) {
                if (hasJsonLdMatch) break;
                const jsonText = script.textContent;
                if (!jsonText) continue;
                try {
                    const data = JSON.parse(jsonText);
                    const roots = Array.isArray(data) ? data : [data];
                    for (const root of roots) {
                        if (!root || typeof root !== 'object') continue;
                        const nodes = [root];
                        if (Array.isArray(root['@graph'])) nodes.push(...root['@graph']);
                        for (const node of nodes) {
                            if (!node || typeof node !== 'object' || !node.offers) continue;
                            const offerList = Array.isArray(node.offers) ? node.offers : [node.offers];
                            for (const offer of offerList) {
                                if (!offer || typeof offer !== 'object') continue;
                                const rawPrice = offer.price !== null && offer.price !== undefined
                                ? offer.price
                                : offer.lowPrice;
                                const ldPrice = Number.parseFloat(rawPrice);
                                if (Number.isFinite(ldPrice) && Math.abs(ldPrice - target) < 0.01) {
                                    hasJsonLdMatch = true;
                                    break;
                                }
                            }
                            if (hasJsonLdMatch) break;
                        }
                        if (hasJsonLdMatch) break;
                    }
                } catch (_) {}
            }

            const elements = Array.from(document.querySelectorAll('body *'));
            let bestElement = null;
            let minLength = Infinity;

            for (const el of elements) {
                if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'HEAD', 'META', 'SVG', 'DEL', 'S', 'STRIKE'].includes(el.nodeName)) continue;

                const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
                if (cls.includes('old') || cls.includes('crossed') || cls.includes('omnibus') || cls.includes('lowest')) continue;

                const rawText = el.textContent || '';
                const cleanText = rawText.replace(/[\s\u00A0\u200B\u202F\uFEFF]/g, '');

                if (!cleanText || cleanText.length > 200) continue;
                if (/rat|mies/i.test(cleanText)) continue;

                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;

                const matches = cleanText.match(/\d+(?:[.,]\d+)?/g);
                if (!matches) continue;

                let isMatch = false;
                for (const m of matches) {
                    const val = parseFloat(m.replace(',', '.'));
                    if (Math.abs(val - target) < 0.01 || Math.abs(val - Math.round(target * 100)) < 0.01) {
                        isMatch = true;
                        break;
                    }
                }

                if (isMatch && cleanText.length < minLength) {
                    minLength = cleanText.length;
                    bestElement = el;
                }
            }

            if (!bestElement) {
                return hasJsonLdMatch ? 'JSON_LD' : null;
            }

            function getSelector(el) {
                const path = [];
                let current = el;
                while (current && current.nodeType === Node.ELEMENT_NODE && current.nodeName !== 'HTML' && current.nodeName !== 'BODY') {
                    let sel = current.nodeName.toLowerCase();

                    if (current.id && !current.id.includes('-') && !/\d/.test(current.id)) {
                        sel += '#' + current.id;
                        path.unshift(sel);
                        break;
                    }

                    const validClasses = Array.from(current.classList || []).filter(
                        c => /^[a-zA-Z0-9-]+$/.test(c) &&
                             !c.startsWith('_ng') &&
                             !c.startsWith('ng-') &&
                             !/^[a-z0-9]{4,5}_[a-z0-9]{2,3}$/i.test(c) &&
                             !/^_[a-z0-9]{5}_/i.test(c)
                    );

                    if (validClasses.length > 0 && validClasses[0].length > 4) {
                        sel += '.' + validClasses[0];
                    }

                    let sib = current, nth = 1;
                    while ((sib = sib.previousElementSibling)) {
                        if (sib.nodeName.toLowerCase() === current.nodeName.toLowerCase()) nth++;
                    }
                    if (nth > 1) sel += `:nth-of-type(${nth})`;

                    path.unshift(sel);
                    const candidate = path.join(' > ');
                    if (document.querySelectorAll(candidate).length === 1) {
                        return candidate;
                    }
                    current = current.parentElement;
                }
                return 'body > ' + path.join(' > ');
            }

            return getSelector(bestElement);
        }, targetPrice);

        if (!selector) {
            const debugPath = `debug-${targetPrice}.png`;
            console.log(`\x1b[33mCouldn't find the target price (${targetPrice}) on "${await page.title()}". Saving screenshot: ${debugPath}\x1b[0m`);
            await page.screenshot({ path: debugPath, fullPage: true });
        }

        return selector;
    } catch (error) {
        console.error('Error:\n', error.message);
        return null;
    } finally {
        await browser.close();
        console.log('Done.');
    }
}

async function checkPrice(url, selector, alertName = '') {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080'
        ]
    });

    let page = null;
    try {
        page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        const rawUa = await browser.userAgent();
        await page.setUserAgent(rawUa.replace('HeadlessChrome', 'Chrome'));

        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
        await page.evaluate(() => {
            window.scrollBy(0, 500);
        });
        await new Promise(r => setTimeout(r, 800));
        await page.evaluate(() => {
            window.scrollBy(0, 400);
        });

        try {
            await page.waitForNetworkIdle({ idleTime: 1000, timeout: 6000 });
        } catch (_) {}
        await new Promise(r => setTimeout(r, 1000));
        const evalResult = await page.evaluate((sel) => {
            // Parser
            const ldScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
            let hasAvailableOffer = false;
            let hasUnavailableOffer = false;
            let jsonLdPrice = null;

            for (const script of ldScripts) {
                try {
                    const data = JSON.parse(script.textContent);
                    const roots = Array.isArray(data) ? data : [data];
                    for (const root of roots) {
                        if (!root || typeof root !== 'object') continue;
                        const nodes = Array.isArray(root['@graph']) ? [root, ...root['@graph']] : [root];
                        for (const node of nodes) {
                            if (node && node.offers) {
                                const offerList = Array.isArray(node.offers) ? node.offers : [node.offers];
                                for (const offer of offerList) {
                                    if (!offer || typeof offer !== 'object') continue;
                                    const avail = String(offer.availability || '');
                                    if (/InStock|PreOrder|LimitedAvailability|OnlineOnly|InStoreOnly/i.test(avail)) {
                                        hasAvailableOffer = true;
                                    } else if (/OutOfStock|Discontinued|SoldOut/i.test(avail)) {
                                        hasUnavailableOffer = true;
                                    }
                                    if (!jsonLdPrice) {
                                        const p = offer.price || offer.lowPrice || (offer.priceSpecification && offer.priceSpecification.price);
                                        if (p) jsonLdPrice = String(p);
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {}
            }

            if (hasUnavailableOffer && !hasAvailableOffer) {
                return { unavailable: true, priceText: null };
            }

            const metaTags = document.querySelectorAll('meta[property="product:price:amount"], meta[itemprop="price"], meta[name="product:price:amount"]');
            for (const meta of Array.from(metaTags)) {
                if (meta.content) return { unavailable: false, priceText: String(meta.content) };
            }

            if (jsonLdPrice) {
                return { unavailable: false, priceText: jsonLdPrice };
            }

            // CSS Selector from DB
            if (sel && sel !== 'JSON_LD') {
                const el = document.querySelector(sel);
                if (el) {
                    const contentAttr = el.getAttribute('content');
                    if (contentAttr) return { unavailable: false, priceText: String(contentAttr) };
                    return { unavailable: false, priceText: String(el.textContent) };
                }
            }

            const fallbackClasses = document.querySelectorAll('[itemprop="price"], .price, .cena, [data-price]');
            for (const fallback of Array.from(fallbackClasses)) {
                const txt = fallback.textContent || fallback.getAttribute('content');
                if (txt && /\d/.test(txt)) return { unavailable: false, priceText: String(txt) };
            }

            const bodyText = (document.body ? document.body.innerText : '').toLowerCase();
            const unavailablePhrases = [
                'produkt niedostępny',
                'towar niedostępny',
                'chwilowo niedostępny',
                'czasowo niedostępny',
                'obecnie niedostępny',
                'brak w magazynie',
                'brak towaru',
                'wyprzedane',
                'wyprzedany',
                'produkt wycofany',
                'oferta nieaktualna',
                'ogłoszenie nieaktualne',
                'powiadom o dostępności',
                'out of stock',
                'currently unavailable',
                'sold out',
                'discontinued'
            ];

            if (unavailablePhrases.some(phrase => bodyText.includes(phrase))) {
                return { unavailable: true, priceText: null };
            }

            return { unavailable: false, priceText: null };
        }, selector);

        if (evalResult.unavailable) {
            return { status: 'UNAVAILABLE' };
        }

        if (evalResult.priceText) {
            let cleanText = evalResult.priceText.replace(/[\s\u00A0\u200B\u202F\uFEFF]/g, '');
            if (cleanText.includes(',') && !cleanText.includes('.')) {
                cleanText = cleanText.replace(',', '.');
            }

            const matches = cleanText.match(/\d+(?:\.\d+)?/g);
            if (matches) {
                for (const m of matches) {
                    const val = parseFloat(m);
                    if (!isNaN(val)) return { status: 'OK', price: val };
                }
            }
        }

        const savedPath = await saveScreenshot(page, alertName);
        console.log(`\x1b[33m[SCRAPER] Price not found for "${alertName || url}". Screenshot saved: ${savedPath}\x1b[0m`);
        return { status: 'ERROR' };

    } catch (e) {
        const savedPath = await saveScreenshot(page, alertName);
        console.error('Error while price checking:', e.message, savedPath ? `(Screenshot: ${savedPath})` : '');
        return { status: 'ERROR' };
    } finally {
        await browser.close();
    }
}

module.exports = { findPriceSelector, checkPrice };