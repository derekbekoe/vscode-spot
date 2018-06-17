import * as cp from 'child_process';
import opn = require('opn');
import * as path from 'path';
import * as semver from 'semver';
import { MessageItem, window } from 'vscode';

import { createServer, ipcQueue, readJSON } from './ipc';
import { Logging } from './logging';
import { SpotFileTracker } from './spotFiles';
import { SpotSession } from "./spotUtil";
import {spotHealthCheck } from './spotUtil';

export class WindowsRequireNodeError extends Error {}

// Adapted from https://github.com/Microsoft/vscode-azure-account
async function createSpotConsole(session: SpotSession): Promise<void> {
    const isWindows = process.platform === 'win32';
    const hostname = session.hostname;
    const token = session.token;
    const shellPath = isWindows ? 'node.exe' : path.join(__dirname, '../../console_bin/node.sh');
    let modulePath = path.join(__dirname, 'consoleLauncher');
    if (isWindows) {
        modulePath = modulePath.replace(/\\/g, '\\\\');
    }
    const shellArgs = [
        process.argv0,
        '-e',
        `require('${modulePath}').main()`
    ];
    if (isWindows) {
        shellArgs.shift();
    }
    // ipc
    const ipc = await createServer('vscode-spot-console', async (req, res) => {
        let dequeue = false;
        for (const message of await readJSON<any>(req)) {
            if (message.type === 'poll') {
                dequeue = true;
            } else if (message.type === 'log') {
                Logging.log(...message.args);
            } else if (message.type === 'status') {
                Logging.log('Received status message');
            }
        }
        let response = [];
        if (dequeue) {
            try {
                response = await ipcQueue.dequeue(60000);
            } catch (err) {
                console.error(err);
            }
        }
        res.write(JSON.stringify(response));
        res.end();
    });
    const terminal = window.createTerminal({
        name: `Spot ${hostname}`,
        shellPath: shellPath,
        shellArgs: shellArgs,
        env: {CONSOLE_IPC: ipc.ipcHandlePath}
    });
    terminal.show();
    ipcQueue.push({
        type: 'connect',
        accessToken: token,
        consoleUri: hostname
    });
}

async function windowsPrereqsOkay(): Promise<boolean> {
    try {
        const stdout = cp.execSync('node.exe --version').toString();
        const version = stdout[0] === 'v' && stdout.substr(1).trim();
        if (version && semver.valid(version) && !semver.gte(version, '6.0.0')) {
            throw new Error('Bad node version');
        }
        return true;
    } catch (err) {
        Logging.log(err);
        const open: MessageItem = { title: "Download Node.js" };
        // tslint:disable-next-line:max-line-length
        const message = "Opening a Spot currently requires Node.js 6 or later to be installed (https://nodejs.org) on Windows.";
        const msgItem: MessageItem | undefined = await window.showInformationMessage(message, open);
        if (msgItem === open) {
            opn('https://nodejs.org');
        }
        return false;
    }
}

export async function spotConnect(hostname: string,
                                  instanceToken: string,
                                  spotFileTracker: SpotFileTracker): Promise<SpotSession> {
    const isWindows = process.platform === 'win32';
    if (isWindows && !await windowsPrereqsOkay()) {
        throw new WindowsRequireNodeError('Node requirements on Windows not satisfied.');
    }
    window.showInformationMessage('Running health check for spot');
    await spotHealthCheck(hostname, instanceToken);
    const activeSession = new SpotSession(hostname, instanceToken);
    spotFileTracker.connect(activeSession);
    await createSpotConsole(activeSession);
    return activeSession;
}
