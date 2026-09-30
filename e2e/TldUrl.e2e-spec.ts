import type { Page, Request, Route } from '@playwright/test';
import { test, expect } from './global-setup';

const resultPath = '/en/result/226f6d4f44ae3f80/';

async function mockTldUrl(page: Page, handle: (route: Route) => Promise<void>) {
    await page.route(/\/api$/, async (route) => {
        if (route.request().postDataJSON()?.method === 'get_tld_url') {
            await handle(route);
        } else {
            await route.fallback();
        }
    });
}

async function fulfillTldUrl(route: Route, result: { url?: string }) {
    await route.fulfill({
        json: { jsonrpc: '2.0', id: route.request().postDataJSON().id, result },
    });
}

async function expectResults(page: Page) {
    await expect(
        page.getByRole('heading', { name: 'Test result for results.afNiC.Fr' }),
    ).toBeVisible();
    await expect(page.locator('.zm-result')).toBeVisible();
}

test.describe('TLD URL on test results', () => {
    // Clipboard contents are shared across browser contexts.
    test.describe.configure({ mode: 'serial' });

    for (const url of ['https://www.afnic.fr/', 'http://www.afnic.fr/']) {
        test(`displays and copies ${url}`, async ({ page, context }) => {
            await context.grantPermissions(['clipboard-read', 'clipboard-write']);
            await mockTldUrl(page, (route) => fulfillTldUrl(route, { url }));
            const requestPromise = page.waitForRequest(
                (request) => request.postDataJSON()?.method === 'get_tld_url',
            );

            await page.goto(resultPath);
            const request = await requestPromise;
            expect(request.postDataJSON().params).toEqual({
                domain: 'results.afNiC.Fr',
            });
            await expectResults(page);

            const button = page.locator('#zmTLDURLButton');
            const dialog = page.locator('#copyTLDURLDialog');
            await expect(button).toBeVisible();
            await expect(dialog).toBeHidden();
            await button.click();
            await expect(dialog).toBeVisible();
            await expect(dialog.locator('input[name="url"]')).toHaveValue(url);
            await dialog.locator('.zm-copy').click();
            await expect(dialog.locator('.zm-copy')).toHaveAttribute('aria-label', 'Copied');
            expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
        });
    }

    for (const [description, result] of [
        ['omitted', {}],
        ['empty', { url: '' }],
    ] as const) {
        test(`hides the button when the URL is ${description}`, async ({ page }) => {
            await mockTldUrl(page, (route) => fulfillTldUrl(route, result));
            const responsePromise = page.waitForResponse(
                (response) => response.request().postDataJSON()?.method === 'get_tld_url',
            );

            await page.goto(resultPath);
            await (await responsePromise).finished();
            await expectResults(page);
            await expect(page.locator('#zmTLDURLButton')).toBeHidden();
        });
    }

    for (const failure of ['RPC error', 'network error']) {
        test(`keeps results visible after a ${failure}`, async ({ page }) => {
            await mockTldUrl(page, async (route) => {
                if (failure === 'network error') {
                    await route.abort('failed');
                } else {
                    await route.fulfill({
                        json: {
                            jsonrpc: '2.0',
                            id: route.request().postDataJSON().id,
                            error: { code: -32601, message: 'Method not found' },
                        },
                    });
                }
            });
            const isTldUrlRequest = (request: Request) =>
                request.postDataJSON()?.method === 'get_tld_url';
            const requestPromise =
                failure === 'network error'
                    ? page.waitForEvent('requestfailed', isTldUrlRequest)
                    : page.waitForEvent('requestfinished', isTldUrlRequest);

            await page.goto(resultPath);
            await requestPromise;
            await expectResults(page);
            await expect(page.locator('#zmTLDURLButton')).toBeHidden();
        });
    }

    test('shows results while waiting for the TLD URL', async ({ page }) => {
        let releaseRequest!: () => void;
        const pending = new Promise<void>((resolve) => {
            releaseRequest = resolve;
        });
        await mockTldUrl(page, async (route) => {
            await pending;
            await fulfillTldUrl(route, { url: 'https://www.afnic.fr/' });
        });
        const requestPromise = page.waitForRequest(
            (request) => request.postDataJSON()?.method === 'get_tld_url',
        );

        try {
            await page.goto(resultPath, { waitUntil: 'domcontentloaded' });
            await requestPromise;
            await expectResults(page);
            await expect(page.locator('#zmTLDURLButton')).toBeHidden();
        } finally {
            releaseRequest();
        }

        await expect(page.locator('#zmTLDURLButton')).toBeVisible();
    });
});
