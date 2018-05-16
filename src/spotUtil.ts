import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { URL } from 'url';

export class SpotSession {
    constructor(public hostname: string, public token: string) {}
}

export function getWsProtocol(consoleUrl: URL) {
    return consoleUrl.protocol.startsWith('https') ? 'wss' : 'ws';
}

export function ensureDirectoryExistence(filePath: string) {
    var dirname = path.dirname(filePath);
    if (fs.existsSync(dirname)) {
      return true;
    }
    ensureDirectoryExistence(dirname);
    fs.mkdirSync(dirname);
}

class KnownSpotInfo {
    constructor(public hostname: string, public instanceToken: string){}
}

export class KnownSpots {

    knownSpotsFile: string;

    readonly FILE_MODE = process.platform === 'win32' ? 0o666 : 0o600;

    constructor() {
        this.knownSpotsFile = path.join(os.homedir(), '.vscode-spot', 'knownSpots.json');
        ensureDirectoryExistence(this.knownSpotsFile);
        if (!fs.existsSync(this.knownSpotsFile)) {
            fs.writeFileSync(this.knownSpotsFile, JSON.stringify({}), {mode: this.FILE_MODE});
        }
    }

    public getAll(): any {
        return JSON.parse(fs.readFileSync(this.knownSpotsFile).toString());
    }

    public isKnown(spotName: string) {
        return spotName in this.getAll();
    }

    public clear() {
        fs.writeFileSync(this.knownSpotsFile, JSON.stringify({}), {mode: this.FILE_MODE});
        console.log('Cleared known spots.');
    }
    
    public add(spotName: string, hostname: string, instanceToken: string) {
        var spots = this.getAll();
        spots[spotName] = new KnownSpotInfo(hostname, instanceToken);
        fs.writeFileSync(this.knownSpotsFile, JSON.stringify(spots), {mode: this.FILE_MODE});
        console.log(`Added known spot: name=${spotName} hostname=${hostname}`);
    }
    
    public get(spotName: string) {
        return this.getAll()[spotName];
    }
    
    public remove(spotName: string) {
        var spots = this.getAll();
        delete spots[spotName];
        fs.writeFileSync(this.knownSpotsFile, JSON.stringify(spots), {mode: this.FILE_MODE});
        console.log(`Removed known spot: name=${spotName}`);
    }

}
