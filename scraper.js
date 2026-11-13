const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

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

async function checkPrice(url, selector) {
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
        
        let priceText = await page.evaluate((sel) => {
            const metaTags = document.querySelectorAll('meta[property="product:price:amount"], meta[itemprop="price"], meta[name="product:price:amount"]');
            for (const meta of Array.from(metaTags)) {
                if (meta.content) return String(meta.content);
            }

            // Parser
            const ldScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
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
                                    const p = offer.price || offer.lowPrice || (offer.priceSpecification && offer.priceSpecification.price);
                                    if (p) return String(p);
                                }
                            }
                        }
                    }
                } catch(e) {}
            }

            // CSS Selector from DB
            if (sel && sel !== 'JSON_LD') {
                const el = document.querySelector(sel);
                if (el) {
                    const contentAttr = el.getAttribute('content');
                    if (contentAttr) return String(contentAttr);
                    return String(el.textContent);
                }
            }
            const fallbackClasses = document.querySelectorAll('[itemprop="price"], .price, .cena, [data-price]');
            for (const fallback of Array.from(fallbackClasses)) {
                const txt = fallback.textContent || fallback.getAttribute('content');
                if (txt && /\d/.test(txt)) return String(txt);
            }

            return null;
        }, selector);

        if (!priceText) return null;
        let cleanText = priceText.replace(/[\s\u00A0\u200B\u202F\uFEFF]/g, '');
        if (cleanText.includes(',') && !cleanText.includes('.')) {
            cleanText = cleanText.replace(',', '.');
        }

        const matches = cleanText.match(/\d+(?:\.\d+)?/g);
        if (!matches) return null;

        for (const m of matches) {
            const val = parseFloat(m);
            if (!isNaN(val)) return val;
        }

        return null;

    } catch (e) {
        console.error('Błąd sprawdzania ceny:', e.message);
        return null;
    } finally {
        await browser.close();
    }
}

module.exports = { findPriceSelector, checkPrice };