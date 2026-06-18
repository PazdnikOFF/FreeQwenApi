import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

import { loadTokens, saveTokens, markValid, removeToken } from '../api/tokenManager.js';
import { logInfo, logError } from '../logger/index.js';
import { prompt } from './prompt.js';
import { formatForgetMeAiWatermark } from './branding.js';
import { SESSION_DIR, ACCOUNTS_DIR } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'qwen_browser_auth.js');

function runBrowserAuth() {
    const result = spawnSync(process.execPath, [AUTH_SCRIPT], { stdio: 'inherit' });
    return result.status === 0;
}

export async function addAccountInteractive() {
    logInfo('======================================================');
    logInfo('Добавление нового аккаунта Qwen');
    logInfo(formatForgetMeAiWatermark());
    logInfo('======================================================');

    const ok = runBrowserAuth();
    if (!ok) {
        logError('Авторизация не была завершена.');
        return null;
    }

    const tokens = loadTokens();
    logInfo(`Аккаунт добавлен. Всего аккаунтов: ${tokens.length}`);
    logInfo('======================================================');
    return tokens[tokens.length - 1]?.id || null;
}

export async function interactiveAccountMenu() {
    while (true) {
        console.log('\n=== Меню управления аккаунтами ===');
        console.log(formatForgetMeAiWatermark());
        console.log('1 - Добавить новый аккаунт');
        console.log('2 - Завершить');
        const choice = await prompt('Ваш выбор (1/2): ');
        if (choice === '1') await addAccountInteractive();
        else if (choice === '2') break;
        else console.log('Неверный выбор.');
    }
}

export async function reloginAccountInteractive() {
    const tokens = loadTokens();
    const invalids = tokens.filter(t => t.invalid);
    if (!invalids.length) {
        console.log('Нет аккаунтов, требующих повторного входа.');
        await prompt('Нажмите ENTER чтобы вернуться в меню...');
        return;
    }

    console.log('\nАккаунты с истекшим токеном:');
    invalids.forEach((t, idx) => console.log(`${idx + 1} - ${t.id}`));
    const choice = await prompt('Выберите номер аккаунта для повторного входа: ');
    const num = parseInt(choice, 10);
    if (isNaN(num) || num < 1 || num > invalids.length) {
        console.log('Неверный выбор.');
        return;
    }
    const account = invalids[num - 1];

    logInfo(`Повторная авторизация для ${account.id}`);
    logInfo(formatForgetMeAiWatermark());

    const ok = runBrowserAuth();
    if (!ok) { logError('Авторизация не была завершена.'); return; }

    const updated = loadTokens().find(t => t.id === account.id);
    if (updated?.token) {
        logInfo(`Токен обновлён для ${account.id}`);
    } else {
        logError('Токен для аккаунта не найден после авторизации.');
    }
}

export async function removeAccountInteractive() {
    const tokens = loadTokens();
    if (!tokens.length) {
        console.log('Нет сохранённых аккаунтов.');
        await prompt('ENTER чтобы вернуться...');
        return;
    }

    console.log('\nДоступные аккаунты:');
    tokens.forEach((t, idx) => console.log(`${idx + 1} - ${t.id}`));
    const choice = await prompt('Номер аккаунта, который нужно удалить (или ENTER для отмены): ');
    if (!choice) return;
    const num = parseInt(choice, 10);
    if (isNaN(num) || num < 1 || num > tokens.length) {
        console.log('Неверный выбор.');
        await prompt('ENTER чтобы вернуться...');
        return;
    }

    const acc = tokens[num - 1];
    const confirm = await prompt(`Точно удалить ${acc.id}? (y/N): `);
    if (confirm.toLowerCase() !== 'y') return;

    removeToken(acc.id);
    const dir = path.resolve(__dirname, '..', '..', SESSION_DIR, ACCOUNTS_DIR, acc.id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });

    logInfo(`Аккаунт ${acc.id} удалён.`);
    await prompt('ENTER чтобы вернуться...');
}
