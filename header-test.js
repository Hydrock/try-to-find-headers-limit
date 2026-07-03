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

        if (remaining <= 0) {
            break;
        }

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

async function main() {
    const rl = readline.createInterface({ input, output });

    try {
        const url = await rl.question('Введите URL: ');

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

        console.log('\n=== Sending request ===');

        const startedAt = Date.now();

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
        console.log(bodyText.slice(0, 3000));

        if (bodyText.length > 3000) {
            console.log(`\n... body truncated, total length: ${bodyText.length} chars`);
        }
    } catch (error) {
        console.log('\n=== Request failed ===');
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