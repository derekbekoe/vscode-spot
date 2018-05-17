import * as vscode from "vscode";
import { SpotFile, SpotFileTracker } from "./spotFiles";

export enum TNodeKind { NODE_FILE, NODE_FOLDER }

/* tslint:disable:max-classes-per-file member-ordering */

export class SpotTreeDataProvider implements vscode.TreeDataProvider<TNode> {

  // tslint:disable-next-line:variable-name
  private _onDidChangeTreeData: vscode.EventEmitter<TNode | undefined> = new vscode.EventEmitter<TNode | undefined>();
  public readonly onDidChangeTreeData: vscode.Event<TNode | undefined> = this._onDidChangeTreeData.event;

  constructor(private fileTracker: SpotFileTracker) {
    fileTracker.onFilesChanged((files) => {
      this._onDidChangeTreeData.fire();
    });

  }

  public getTreeItem(element: TNode): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: TNode): Thenable<TNode[]> {
    return new Promise((resolve) => {
      const ll: TNode[] = [];
      const spMap: Map<string, SpotFile> = element ? element.spotFile.children : this.fileTracker.files;
      for (const f of spMap.keys()) {
        const v: SpotFile | undefined = spMap.get(f);
        if (v) {
          const bnCommand = v.isDirectory ? undefined : {
              command: "spot.OpenFileEditor",
              title: f,
              arguments: [v.path, v.spotSession],
          };
          const bn: TNode = new TNode(f, v.isDirectory ? TNodeKind.NODE_FOLDER : TNodeKind.NODE_FILE, v, bnCommand);
          ll.push(bn);
        }
      }
      resolve(ll);
    });
  }
}

class TNode extends vscode.TreeItem {

  constructor(
    public readonly label: string,
    public readonly kind: TNodeKind,
    public readonly spotFile: SpotFile,
    public readonly command?: vscode.Command
  ) {
    // tslint:disable-next-line:max-line-length
    super(label, (kind === TNodeKind.NODE_FILE) ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = (kind === TNodeKind.NODE_FILE) ? "NodeFile" : "NodeFolder";
  }
}
