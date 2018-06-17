import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as rimraf from 'rimraf';
import * as tmp from 'tmp';
import { URL } from 'url';
import { commands, Event, EventEmitter, TextDocumentSaveReason, TextDocumentWillSaveEvent, Uri, window,
         workspace } from 'vscode';
import * as WS from 'ws';

import { Logging } from './logging';
import { ensureDirectoryExistence, getWsProtocol, SpotSession } from './spotUtil';

/* tslint:disable:max-classes-per-file */

export class SpotFile {
    constructor(public isDirectory: boolean,
                // tslint:disable-next-line:no-shadowed-variable
                public path: string,
                public spotSession: SpotSession,
                public children: Map<string, SpotFile> = new Map<string, SpotFile>()) {}
}

export class SpotFileTracker {

  public files: Map<string, SpotFile> = new Map<string, SpotFile>();
  private ws: WS | undefined;

  private onFilesChangedEmitter = new EventEmitter<Map<string, SpotFile>>();
  get onFilesChanged(): Event<Map<string, SpotFile>> {return this.onFilesChangedEmitter.event; }

  public connect(session: SpotSession) {
    const url = new URL(session.hostname);
    const socketProtocol = getWsProtocol(url);
    const socketUri = `${socketProtocol}://${url.hostname}:${url.port}/files/?token=${session.token}`;
    let handledRootDir: boolean = false;
    this.files = new Map<string, SpotFile>();
    this.onFilesChangedEmitter.fire(this.files);
    this.ws = new WS(socketUri);
    this.ws.on('open', () => {
      Logging.log('socket open');
      handledRootDir = false;
    });

    this.ws.on('message', (data: string) => {
      Logging.log('socket data', data);
      const objdata = JSON.parse(data);
      if (objdata.event === 'addDir'  || objdata.event === 'add') {
        if (objdata.event === 'addDir' && !handledRootDir) {
          handledRootDir = true;
          const segments: string[] = objdata.path.split('/');
          for (let i = 1; i <= segments.length; i++) {
            const s: string = segments.slice(0, i).join('/');
            this.addFileOrDir(true, s, session);
          }
        } else {
          this.addFileOrDir(objdata.event === 'addDir', objdata.path, session);
        }
      } else if (objdata.event === 'unlinkDir' || objdata.event === 'unlink') {
        const segments: string[] = objdata.path.split('/').slice(1);
        let fparent = this.files;
        for (let i = 0; i < segments.length - 1; i++) {
          const segmentv = fparent.get(segments[i]);
          if (segmentv) {
            fparent = segmentv.children;
          }
        }
        fparent.delete(segments[segments.length - 1]);
      }
      this.onFilesChangedEmitter.fire(this.files);
    });

    this.ws.on('error', (event) => {
      console.error('Socket error: ' + JSON.stringify(event));
    });

    this.ws.on('close', () => {
      Logging.log('Socket closed');
    });
  }

  public disconnect() {
    this.files = new Map<string, SpotFile>();
    this.onFilesChangedEmitter.fire(this.files);
    if (this.ws) {
      this.ws.terminate();
    }
    // Delete the directory on disconnect.
    if (tmpobj) {
      const dirname = path.join(tmpobj.name, '_spot');
      rimraf.sync(dirname);
    }
    commands.executeCommand('setContext', 'canShowSpotExplorer', false);
  }

  // tslint:disable-next-line:no-shadowed-variable
  private addFileOrDir(isDirectory: boolean, path: string, session: SpotSession) {
    const newNode = new SpotFile(isDirectory, path, session);
    const segments: string[] = path.split('/').slice(1);
    let files = this.files;
    for (const segment of segments) {
      const segmentv = files.get(segment);
      if (segmentv) {
        files = segmentv.children;
      } else {
        files.set(segment, newNode);
        files = newNode.children;
      }
    }
  }
}

const tmpobj = tmp.dirSync();

export function openFileEditor(documentPath: any, session: SpotSession) {
  const storagePath: string = tmpobj.name;
  const tmpDirName: string = '_spot';
  if (!session) {
    console.error("Unable to open file editor. Session not set.");
    return;
  }
  const url = new URL(session.hostname);
  const socketProtocol = getWsProtocol(url);
  const fileId = createHash('md5').update(documentPath).digest('hex');
  const socketUri = `${socketProtocol}://${url.hostname}:${url.port}/file/${fileId}/?token=${session.token}`;
  const ws = new WS(socketUri);
  ws.on('open', () => {
    const data = {event: 'fileDownload', path: documentPath};
    ws!.send(JSON.stringify(data));
  });
  ws.on('message', (data: Buffer) => {
    if (!storagePath) {
      console.error('storagePath is undefined!');
      return;
    }
    const tmpPath = path.join(storagePath, tmpDirName, documentPath);
    ensureDirectoryExistence(tmpPath);
    fs.writeFile(tmpPath, data, (err) => {
      if (err) {
        console.error("Error writing file", err);
      } else {
        const uriDocBookmark: Uri = Uri.file(tmpPath);
        workspace.openTextDocument(uriDocBookmark).then((doc) => {
            window.showTextDocument(doc);
        });
        workspace.onWillSaveTextDocument((e: TextDocumentWillSaveEvent) => {
            if (e.document.fileName === tmpPath && e.reason === TextDocumentSaveReason.Manual) {
              ws.send(e.document.getText());
            } else if (process.platform === 'win32') {
              // Capitalize the drive letter to match tmp path and try again.
              let docFileName = e.document.fileName;
              docFileName = docFileName.charAt(0).toUpperCase() + docFileName.slice(1);
              if (docFileName === tmpPath && e.reason === TextDocumentSaveReason.Manual) {
                ws.send(e.document.getText());
              }
            }
        });
      }
    });
  });
  ws.on('error', (event) => {
    console.error('Socket error: ' + JSON.stringify(event));
  });
  ws.on('close', () => {
    Logging.log('Socket closed');
  });
}
