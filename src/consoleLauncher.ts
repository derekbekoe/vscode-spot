import * as request from 'request-promise';
import * as WS from 'ws';
import * as http from 'http';
import { URL } from 'url';
import { sendData, readJSON } from './ipc';
import { getWsProtocol } from './spotUtil';


async function delay(ms: number) {
	return new Promise<void>(resolve => setTimeout(resolve, ms));
}


function getWindowSize() {
	const stdout: any = process.stdout;
	const windowSize: [number, number] = stdout.isTTY ? stdout.getWindowSize() : [80, 30];
	return {
		cols: windowSize[0],
		rows: windowSize[1],
	};
}

async function initializeTerminal(accessToken: string, consoleUri: string) {
	const initialGeometry = getWindowSize();
	return request({
		uri: `${consoleUri}/terminals?cols=${initialGeometry.cols}&rows=${initialGeometry.rows}&token=${accessToken}`,
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Accept': 'application/json'
		},
		simple: false,
		resolveWithFullResponse: true,
		json: true
	});
}

function connectSocket(ipcHandle: string, url: string) {

	const ws = new WS(url);

	ws.on('open', function () {
		process.stdin.on('data', function (data) {
			ws.send(data);
		});
		startKeepAlive();
		sendData(ipcHandle, JSON.stringify([ { type: 'status', status: 'Connected' } ]))
			.catch(err => {
				console.error(err);
			});
	});

	ws.on('message', function (data) {
		process.stdout.write(String(data));
	});

	let error = false;
	ws.on('error', function (event) {
		error = true;
		console.error('Socket error: ' + JSON.stringify(event));
	});

	ws.on('close', function () {
		console.log('Socket closed');
		sendData(ipcHandle, JSON.stringify([ { type: 'status', status: 'Disconnected' } ]))
			.catch(err => {
				console.error(err);
			});
		if (!error) {
			process.exit(0);
		}
	});

	function startKeepAlive() {
		let isAlive = true;
		ws.on('pong', () => {
			isAlive = true;
		});
		const timer = setInterval(() => {
			if (isAlive === false) {
				error = true;
				console.log('Socket timeout');
				ws.terminate();
				clearInterval(timer);
			} else {
				isAlive = false;
				ws.ping();
			}
		}, 60000);
		timer.unref();
	}
}

let resizeToken = {};
async function resize(accessToken: string, consoleUri: string, termId: string) {
	const token = resizeToken = {};
	await delay(300);

	for (let i = 0; i < 10; i++) {
		if (token !== resizeToken) {
			return;
		}

		const { cols, rows } = getWindowSize();
		const response = await request({
			uri: `${consoleUri}/terminals/${termId}/size?cols=${cols}&rows=${rows}&token=${accessToken}`,
			method: 'POST',
			headers: {
				'Accept': 'application/json',
				'Content-Type': 'application/json'
			},
			simple: false,
			resolveWithFullResponse: true,
			json: true,
		});

		if (response.statusCode < 200 || response.statusCode > 299) {
			if (response.statusCode !== 503 && response.statusCode !== 504 && response.body && response.body.error) {
				if (response.body && response.body.error && response.body.error.message) {
					console.log(`${response.body.error.message} (${response.statusCode})`);
				} else {
					console.log(response.statusCode, response.headers, response.body);
				}
				break;
			}
			await delay(1000 * (i + 1));
			continue;
		}

		return;
	}

	console.log('Failed to resize terminal.');
}

async function connectTerminal(ipcHandle: string, accessToken: string, consoleUri: string) {
	for (let i = 0; i < 10; i++) {
		const response = await initializeTerminal(accessToken, consoleUri);

		if (response.statusCode < 200 || response.statusCode > 299) {
			if (response.statusCode !== 503 && response.statusCode !== 504 && response.body && response.body.error) {
				if (response.body && response.body.error && response.body.error.message) {
					console.log(`${response.body.error.message} (${response.statusCode})`);
				} else {
					console.log(response.statusCode, response.headers, response.body);
				}
				break;
			}
			await delay(1000 * (i + 1));
			console.log(`\x1b[AConnecting terminal...${'.'.repeat(i + 1)}`);
			continue;
		}

		const res = response.body;
		const termId = res;
		const consoleUrl = new URL(consoleUri);
		const socketProtocol = getWsProtocol(consoleUrl);
		const socketUri = `${socketProtocol}://${consoleUrl.hostname}:${consoleUrl.port}/terminals/${termId}/?token=${accessToken}`;
		connectSocket(ipcHandle, socketUri);

		process.stdout.on('resize', () => {
			resize(accessToken, consoleUri, termId)
				.catch(console.error);
		});

		return;
	}

	console.log('Failed to connect to the terminal.');
	await sendData(ipcHandle, JSON.stringify([ { type: 'status', status: 'Disconnected' } ]));
}


export function main() {
	process.stdin.setRawMode!(true);
	process.stdin.resume();

	const ipcHandle = process.env.CONSOLE_IPC!;
	(async () => {
		let res: http.IncomingMessage;
		while (res = await sendData(ipcHandle, JSON.stringify([ { type: 'poll' } ]))) {
			for (const message of await readJSON<any>(res)) {
				if (message.type === 'log') {
					console.log(...message.args);
				} else if (message.type === 'connect') {
					connectTerminal(ipcHandle, message.accessToken, message.consoleUri)
						.catch(err => {
							console.error(err);
							sendData(ipcHandle, JSON.stringify([ { type: 'status', status: 'Disconnected' } ]))
								.catch(err => {
									console.error(err);
								});
						});
				} else if (message.type === 'exit') {
					process.exit(message.code);
				}
			}
		}
	})()
		.catch(console.error);
}