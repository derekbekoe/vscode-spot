import { window, Uri, workspace, TextDocumentWillSaveEvent } from 'vscode';

// export class SpotTextDocumentContentProvider implements TextDocumentContentProvider {
//     onDidChange?: Event<Uri> | undefined;
//     provideTextDocumentContent(uri: Uri, token: CancellationToken): string | Thenable<string | null | undefined> | null | undefined {
//         return uri.path;
//     }
// }

export function openFileEditor(documentPath: any) {
        // TODO Save a temp copy of the file locally and open then track changes
        // let uriDocBookmark: Uri = Uri.parse('spot://'+documentPath);
        let uriDocBookmark: Uri = Uri.file(documentPath);
        workspace.openTextDocument(uriDocBookmark).then(doc => {
            window.showTextDocument(doc);
        });
        workspace.onWillSaveTextDocument((e: TextDocumentWillSaveEvent) => {
            // TODO Save to server with websocket
            console.log(e.document);
            console.log(e.reason);
        });
}

