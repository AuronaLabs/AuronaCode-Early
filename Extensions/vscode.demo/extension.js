/**
 * Official VSCode Extension Demo for Aurona Code Compatibility Runtime
 */
const vscode = require('vscode');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  console.log('[vscode-demo] Extension is now active in Aurona WASM Sandbox!');

  // 1. 注册核心命令
  const helloCmd = vscode.commands.registerCommand('vscodeDemo.helloWorld', () => {
    vscode.window.showInformationMessage('Hello from VSCode Extension running in Aurona Code!');
  });

  const statusCmd = vscode.commands.registerCommand('vscodeDemo.showStatus', () => {
    vscode.window.setStatusBarMessage('VSCode Demo Active in Aurona', 4000);
  });

  context.subscriptions.push(helloCmd);
  context.subscriptions.push(statusCmd);
}

function deactivate() {
  console.log('[vscode-demo] Extension deactivated');
}

module.exports = {
  activate,
  deactivate
};
