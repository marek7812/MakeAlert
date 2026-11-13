const { chromium } = require('playwright');

async function findPriceSelector(url, targetPrice) {
    console.log(`Processing request for: ${url}`);

    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--window-size=1920,1080'
        ]
    });

    try {
        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            locale: 'pl-PL',
            timezoneId: 'Europe/Warsaw'
        });

        // Remove bloat
        await context.route('**/*', route => {
            const type = route.request().resourceType();
            const reqUrl = route.request().url();
            if (['image', 'media', 'font'].includes(type) || 
                ['google-analytics', 'facebook', 'hotjar', 'googletagmanager'].some(t => reqUrl.includes(t))) {
                route.abort();
            } else {
                route.continue();
            }
        });

        const page = await context.newPage();

        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2500);

        try {
            const cookieBtn = page.locator('[data-role="accept-consent"], [data-test="button-submitCookie"], button:has-text("Akceptuję"), button:has-text("Zaakceptuj")').first();
            if (await cookieBtn.isVisible({ timeout: 2000 })) {
                await cookieBtn.click();
                await page.waitForTimeout(1000);
            }
        } catch (_) {}

        for (let i = 0; i < 3; i++) {
            await page.keyboard.press('PageDown');
            await page.waitForTimeout(500);
        }

        let blockCount = 0;
        const pageTitle = await page.title();
        const normalizedTitle = pageTitle.toLowerCase();
        if (
            normalizedTitle.includes('robot') ||
            normalizedTitle.includes('zablokowany') ||
            normalizedTitle.includes('captcha')
        ) {
            blockCount++;
            const screenshotPath = `block${blockCount}.png`;
            console.log(`\x1b[31m[ERROR] Anti-bot detected! Saving screenshot: ${screenshotPath}\x1b[0m`);
            await page.screenshot({
                path: screenshotPath,
                fullPage: true
            });
            return null;
        }

        const selector = await page.evaluate((target) => {
            const ldScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
            let hasJsonLdMatch = false;
            for (const script of ldScripts) {
                if (hasJsonLdMatch) break;
                const jsonText = script.textContent;
                if (!jsonText) continue;
                let data;
                try {
                    data = JSON.parse(jsonText);
                } catch (error) {
                    continue;
                }

                const roots = Array.isArray(data) ? data : [data];
                for (const root of roots) {
                    if (!root || typeof root !== 'object') continue;

                    const nodes = [root];
                    if (Array.isArray(root['@graph'])) {
                        nodes.push(...root['@graph']);
                    }
                    for (const node of nodes) {
                        if (!node || typeof node !== 'object') continue;
                        const offers = node.offers;
                        if (!offers) continue;

                        const offerList = Array.isArray(offers) ? offers : [offers];
                        for (const offer of offerList) {
                            if (!offer || typeof offer !== 'object') continue;
                            let rawPrice = offer.price;
                            if (rawPrice === undefined || rawPrice === null || rawPrice === '') {
                                rawPrice = offer.lowPrice;
                            }
                            const ldPrice = Number.parseFloat(rawPrice);
                            if (
                                Number.isFinite(ldPrice) &&
                                Math.abs(ldPrice - target) < 0.01
                            ) {
                                hasJsonLdMatch = true;
                                break;
                            }
                        }
                        if (hasJsonLdMatch) break;
                    }
                    if (hasJsonLdMatch) break;
                }
            }

            const elements = Array.from(document.querySelectorAll('body *'));
            let bestElement = null;
            let minTextLength = Infinity;

            for (const el of elements) {
                if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'IFRAME', 'HEADER', 'FOOTER', 'DEL', 'S', 'STRIKE'].includes(el.tagName)) continue;

                const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
                if (cls.includes('old') || cls.includes('crossed') || cls.includes('omnibus') || cls.includes('lowest')) continue;

                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;

                const rawText = el.textContent || '';
                const cleanText = rawText.replace(/[\s\u00A0\u200B\u202F\uFEFF]/g, '');

                if (!cleanText || cleanText.length > 200) continue;
                if (/rat|mies/i.test(cleanText)) continue;

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

                if (isMatch && cleanText.length < minTextLength) {
                    minTextLength = cleanText.length;
                    bestElement = el;
                }
            }

            if (!bestElement) {
                return hasJsonLdMatch ? 'JSON_LD' : null;
            }

            function buildPath(el) {
                const path = [];
                let current = el;

                while (current && current.nodeType === Node.ELEMENT_NODE && current.tagName !== 'HTML' && current.tagName !== 'BODY') {
                    let sel = current.tagName.toLowerCase();

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
                        if (sib.tagName.toLowerCase() === current.tagName.toLowerCase()) nth++;
                    }
                    if (nth > 1) sel += `:nth-of-type(${nth})`;

                    path.unshift(sel);
                    current = current.parentElement;
                }
                return 'body > ' + path.join(' > ');
            }

            return buildPath(bestElement);
        }, targetPrice);

        let debugPath = `debug-${targetPrice}.png`;
        if (!selector) {
            console.log(`\x1b[33mCouldn't find the target price. Saving screenshot.\x1b[0m`);
            await page.screenshot({ path: debugPath, fullPage: true });
        }

        return selector;
    } catch (error) {
        console.error('Error:\n', error.message);
        return null;
    } finally {
        await browser.close();
        console.log("Done.")
    }
}
module.exports = { findPriceSelector };