#!/usr/bin/env node

const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const crypto = require('node:crypto');

function parseSize(input) {
    const value = input.trim().toLowerCase();
    const match = value.match(/^(\d+(?:\.\d+)?)\s*(b|kb|k|mb|m)?$/);

    if (!match) {
        throw new Error('Размер должен быть вида: 4096, 8kb, 32kb, 1mb');
    }

    const number = Number(match[1]);
    const unit = match[2] || 'b';

    const multipliers = {
        b: 1,
        kb: 1024,
        k: 1024,
        mb: 1024 * 1024,
        m: 1024 * 1024,
    };

    return Math.floor(number * multipliers[unit]);
}

function randomString(bytes) {
    return crypto.randomBytes(Math.ceil(bytes / 2)).toString('hex').slice(0, bytes);
}

function calcHeadersSize(headers) {
    let total = 0;

    for (const [key, value] of Object.entries(headers)) {
        total += Buffer.byteLength(`${key}: ${value}\r\n`);
    }

    total += Buffer.byteLength('\r\n');

    return total;
}

function generateHeaders(targetSize) {
    const headers = {
        'User-Agent': 'header-size-debug-cli/1.0',
        Accept: '*/*',
        'X-Debug-Header-Test': 'true',
    };

    let currentSize = calcHeadersSize(headers);
    let index = 1;

    if (currentSize > targetSize) {
        throw new Error(
            `Минимальный размер базовых заголовков уже ${currentSize} bytes. Укажите размер больше.`
        );
    }

    while (currentSize < targetSize) {
        const headerName = `X-Random-${index}`;
        const overhead = Buffer.byteLength(`${headerName}: \r\n`);
        const remaining = targetSize - currentSize - overhead;

        if (remaining <= 0) break;

        const valueSize = Math.min(remaining, 4096);
        headers[headerName] = randomString(valueSize);

        currentSize = calcHeadersSize(headers);
        index++;
    }

    return headers;
}

function printHeaders(headers, showFullHeaders) {
    console.log('\n=== Headers Summary ===');

    for (const [key, value] of Object.entries(headers)) {
        console.log(`${key}: ${Buffer.byteLength(value)} bytes`);
    }

    console.log('\n=== Generated Headers ===');

    for (const [key, value] of Object.entries(headers)) {
        if (showFullHeaders) {
            console.log(`${key}: ${value}`);
        } else {
            const preview =
                value.length > 200
                    ? `${value.slice(0, 200)}... (${value.length} chars)`
                    : value;

            console.log(`${key}: ${preview}`);
        }
    }
}

async function sendRequest(url, targetSize, showFullHeaders = false) {
    const headers = generateHeaders(targetSize);
    const realHeadersSize = calcHeadersSize(headers);

    console.log('\n======================================');
    console.log(`Request size: ${realHeadersSize} bytes / ${(realHeadersSize / 1024).toFixed(2)} KB`);
    console.log(`Headers count: ${Object.keys(headers).length}`);

    if (showFullHeaders) {
        printHeaders(headers, true);
    }

    const startedAt = Date.now();

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers,
            redirect: 'manual',
        });

        const duration = Date.now() - startedAt;
        const bodyText = await response.text();

        console.log('\n=== Response ===');
        console.log(`Status: ${response.status} ${response.statusText}`);
        console.log(`Duration: ${duration} ms`);
        console.log(`Final URL: ${response.url}`);
        console.log(`Redirected: ${response.redirected}`);

        console.log('\n=== Response headers ===');
        for (const [key, value] of response.headers.entries()) {
            console.log(`${key}: ${value}`);
        }

        console.log('\n=== Body preview ===');
        console.log(bodyText.slice(0, 1000));

        if (bodyText.length > 1000) {
            console.log(`\n... body truncated, total length: ${bodyText.length} chars`);
        }

        return {
            ok: response.status === 200,
            status: response.status,
            statusText: response.statusText,
            size: realHeadersSize,
            duration,
            error: null,
        };
    } catch (error) {
        const duration = Date.now() - startedAt;

        console.log('\n=== Request failed ===');
        console.log(`Duration: ${duration} ms`);
        console.log('Error name:', error.name);
        console.log('Error message:', error.message);

        if (error.cause) {
            console.log('Cause:', error.cause);
        }

        return {
            ok: false,
            status: null,
            statusText: null,
            size: realHeadersSize,
            duration,
            error,
        };
    }
}

async function manualMode(rl, url) {
    const sizeInput = await rl.question(
        'Введите общий размер заголовков, например 4096, 8kb, 32kb, 1mb: '
    );

    const fullHeadersInput = await rl.question(
        'Выводить полные значения заголовков? y/N: '
    );

    const targetSize = parseSize(sizeInput);
    const showFullHeaders = fullHeadersInput.trim().toLowerCase() === 'y';

    const headers = generateHeaders(targetSize);
    const realHeadersSize = calcHeadersSize(headers);

    console.log('\n=== Request info ===');
    console.log(`URL: ${url}`);
    console.log(`Целевой размер заголовков: ${targetSize} bytes`);
    console.log(`Фактический размер заголовков: ${realHeadersSize} bytes`);
    console.log(`Фактический размер заголовков: ${(realHeadersSize / 1024).toFixed(2)} KB`);
    console.log(`Количество заголовков: ${Object.keys(headers).length}`);

    printHeaders(headers, showFullHeaders);

    await sendRequest(url, targetSize, false);
}

async function autoMode(rl, url) {
    const fullHeadersInput = await rl.question(
        'Выводить полные значения заголовков для каждого запроса? y/N: '
    );

    const showFullHeaders = fullHeadersInput.trim().toLowerCase() === 'y';

    let previousGoodSize = null;
    let currentSize = 2 * 1024;

    console.log('\n=== Auto mode started ===');
    console.log('Стартовый размер: 2 KB');
    console.log('Пока ответ 200 — размер увеличивается в 2 раза.');
    console.log('После первого не-200 — возврат на прошлый успешный размер и увеличение по 1 KB.');

    while (true) {
        const result = await sendRequest(url, currentSize, showFullHeaders);

        if (result.ok) {
            previousGoodSize = currentSize;
            currentSize *= 2;
            continue;
        }

        break;
    }

    if (previousGoodSize === null) {
        console.log('\n=== Result ===');
        console.log('Даже запрос с 2 KB заголовков не вернул 200.');
        return;
    }

    console.log('\n=== Switching to precise mode ===');
    console.log(`Последний успешный размер: ${previousGoodSize} bytes / ${(previousGoodSize / 1024).toFixed(2)} KB`);
    console.log('Теперь увеличиваем размер по 1 KB.');

    currentSize = previousGoodSize + 1024;

    while (true) {
        const result = await sendRequest(url, currentSize, showFullHeaders);

        if (result.ok) {
            previousGoodSize = currentSize;
            currentSize += 1024;
            continue;
        }

        console.log('\n=== Final result ===');
        console.log(`Последний успешный размер: ${previousGoodSize} bytes`);
        console.log(`Последний успешный размер: ${(previousGoodSize / 1024).toFixed(2)} KB`);
        console.log(`Первый проблемный размер: ${currentSize} bytes`);
        console.log(`Первый проблемный размер: ${(currentSize / 1024).toFixed(2)} KB`);

        if (result.status) {
            console.log(`Проблемный HTTP status: ${result.status} ${result.statusText}`);
        } else {
            console.log(`Проблема на уровне соединения: ${result.error?.message}`);
        }

        return;
    }
}

async function main() {
    const rl = readline.createInterface({ input, output });

    try {
        const url = await rl.question('Введите URL: ');

        console.log('\nВыберите режим работы:');
        console.log('1 — ручной размер заголовков');
        console.log('2 — автоматический поиск лимита');

        const mode = await rl.question('\nРежим: ');

        if (mode.trim() === '1') {
            await manualMode(rl, url);
            return;
        }

        if (mode.trim() === '2') {
            await autoMode(rl, url);
            return;
        }

        throw new Error('Некорректный режим. Используйте 1 или 2.');
    } catch (error) {
        console.log('\n=== Script failed ===');
        console.log('Error name:', error.name);
        console.log('Error message:', error.message);

        if (error.cause) {
            console.log('Cause:', error.cause);
        }

        console.log('Stack:', error.stack);
    } finally {
        rl.close();
    }
}

main();