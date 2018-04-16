import { Memento } from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

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

    constructor() {
        this.knownSpotsFile = path.join(os.homedir(), '.vscode-spot', 'knownSpots.json');
        ensureDirectoryExistence(this.knownSpotsFile);
        if (!fs.existsSync(this.knownSpotsFile)) {
            fs.writeFileSync(this.knownSpotsFile, JSON.stringify({}), {mode: 0o600});
        }
    }

    public getAll(): any {
        return JSON.parse(fs.readFileSync(this.knownSpotsFile).toString());
    }

    public isKnown(spotName: string) {
        return spotName in this.getAll();
    }

    public clear() {
        fs.writeFileSync(this.knownSpotsFile, JSON.stringify({}), {mode: '0o600'});
        console.log('Cleared known spots.');
    }
    
    public add(spotName: string, hostname: string, instanceToken: string) {
        var spots = this.getAll();
        spots[spotName] = new KnownSpotInfo(hostname, instanceToken);
        fs.writeFileSync(this.knownSpotsFile, JSON.stringify(spots), {mode: '0o600'});
        console.log(`Added known spot: name=${spotName} hostname=${hostname}`);
    }
    
    public get(spotName: string) {
        return this.getAll()[spotName];
    }
    
    public remove(spotName: string) {
        var spots = this.getAll();
        delete spots[spotName];
        fs.writeFileSync(this.knownSpotsFile, JSON.stringify(spots), {mode: '0o600'});
        console.log(`Removed known spot: name=${spotName}`);
    }

}
