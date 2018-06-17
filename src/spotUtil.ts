import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as request from 'request-promise';
import { URL } from 'url';

import { Logging } from './logging';

/* tslint:disable:max-classes-per-file */

export class SpotSetupError extends Error {}
export class UserCancelledError extends Error {}
export class HealthCheckError extends Error {}

export class SpotSession {
    constructor(public hostname: string, public token: string) {}
}

export function ensureDirectoryExistence(filePath: string) {
    const dirname = path.dirname(filePath);
    if (fs.existsSync(dirname)) {
      return true;
    }
    ensureDirectoryExistence(dirname);
    fs.mkdirSync(dirname);
}

export async function spotHealthCheck(hostname: string, instanceToken: string): Promise<void> {
    const secsBetweenAttempts = 4;
    const maxAttempts = 50;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        Logging.log(`Requesting health check from ${hostname}. Attempt ${attempt}/${maxAttempts}.`);
        try {
            const checkUrl: string = `${hostname}/health-check?token=${instanceToken}`;
            Logging.log('Health check to ', checkUrl);
            const resp: any = await request.get(checkUrl, {resolveWithFullResponse: true});
            Logging.log('Health check response', resp);
            if (resp !== undefined) {
                if (resp.statusCode === 200) {
                    Logging.log('Health check successful.');
                    return;
                } else {
                    throw new Error('Spot health check failed');
                }
            }
        } catch (err) {
            Logging.log('Health check response', err);
        }
        Logging.log(`Waiting ${secsBetweenAttempts} sec(s).`);
        await delay(secsBetweenAttempts * 1000);
    }
    Logging.log('Health check timeout');
    throw new Error('Spot health check failed');
}

class KnownSpotInfo {
    constructor(public hostname: string, public instanceToken: string) {}
}

export class KnownSpots {

    private knownSpotsFile: string;

    private readonly FILE_MODE = process.platform === 'win32' ? 0o666 : 0o600;

    constructor() {
        this.knownSpotsFile = path.join(os.homedir(), '.vscode-spot', 'knownSpots.json');
        ensureDirectoryExistence(this.knownSpotsFile);
        if (!fs.existsSync(this.knownSpotsFile)) {
            fs.writeFileSync(this.knownSpotsFile, JSON.stringify({}), {mode: this.FILE_MODE});
        }
    }

    public getAll(): any {
        this.ensureKnownSpotsFileExists();
        return JSON.parse(fs.readFileSync(this.knownSpotsFile).toString());
    }

    public isKnown(spotName: string) {
        return spotName in this.getAll();
    }

    public clear() {
        this.ensureKnownSpotsFileExists();
        fs.writeFileSync(this.knownSpotsFile, JSON.stringify({}), {mode: this.FILE_MODE});
        Logging.log('Cleared known spots.');
    }

    public add(spotName: string, hostname: string, instanceToken: string) {
        const spots = this.getAll();
        spots[spotName] = new KnownSpotInfo(hostname, instanceToken);
        fs.writeFileSync(this.knownSpotsFile, JSON.stringify(spots), {mode: this.FILE_MODE});
        Logging.log(`Added known spot: name=${spotName} hostname=${hostname}`);
    }

    public get(spotName: string) {
        return this.getAll()[spotName];
    }

    public remove(spotName: string) {
        const spots = this.getAll();
        delete spots[spotName];
        fs.writeFileSync(this.knownSpotsFile, JSON.stringify(spots), {mode: this.FILE_MODE});
        Logging.log(`Removed known spot: name=${spotName}`);
    }

    private ensureKnownSpotsFileExists(): void {
        ensureDirectoryExistence(this.knownSpotsFile);
        if (!fs.existsSync(this.knownSpotsFile)) {
            fs.writeFileSync(this.knownSpotsFile, JSON.stringify({}), {mode: this.FILE_MODE});
        }
    }

}
