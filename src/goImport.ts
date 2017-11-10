/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import { parseFilePrelude } from './util';
import { documentSymbols } from './goOutline';
import { promptForMissingTool } from './goInstallTools';
import { getImportablePackages } from './goPackages';

const missingToolMsg = 'Missing tool: ';

export function listPackages(excludeImportedPkgs: boolean = false): Thenable<string[]> {
	let importsPromise = excludeImportedPkgs && vscode.window.activeTextEditor ? getImports(vscode.window.activeTextEditor.document) : Promise.resolve([]);
	let pkgsPromise = getImportablePackages(vscode.window.activeTextEditor.document.fileName);

	return Promise.all([pkgsPromise, importsPromise]).then(([pkgMap, importedPkgs]) => {
		importedPkgs.forEach(pkg => {
			pkgMap.delete(pkg);
		});
		return Array.from(pkgMap.keys()).sort();
	});
}

/**
 * Returns the imported packages in the given file
 *
 * @param document TextDocument whose imports need to be returned
 * @returns Array of imported package paths wrapped in a promise
 */
function getImports(document: vscode.TextDocument): Promise<string[]> {
	let options = { fileName: document.fileName, importsOnly: true, document };
	return documentSymbols(options, null).then(symbols => {
		if (!symbols || !symbols[0] || !symbols[0].children) {
			return [];
		}
		// imports will be of the form { type: 'import', label: '"math"'}
		let imports = symbols[0].children.filter(x => x.type === 'import').map(x => x.label.substr(1, x.label.length - 2));
		return imports;
	});
}

function askUserForImport(): Thenable<string> {
	return listPackages(true).then(packages => {
		return vscode.window.showQuickPick(packages);
	}, err => {
		if (typeof err === 'string' && err.startsWith(missingToolMsg)) {
			promptForMissingTool(err.substr(missingToolMsg.length));
		}
	});
}

export function getTextEditForAddImport(arg: string): vscode.TextEdit {
	// Import name wasn't provided
	if (arg === undefined) {
		return null;
	}

	let { imports, pkg } = parseFilePrelude(vscode.window.activeTextEditor.document.getText());
	let multis = imports.filter(x => x.kind === 'multi');
	if (multis.length > 0) {
		// There is a multiple import declaration, add to the last one
		const lastImportSection = multis[multis.length - 1];
		if (lastImportSection.end === -1) {
			// For some reason there was an empty import section like `import ()`
			return vscode.TextEdit.insert(new vscode.Position(lastImportSection.start + 1, 0), `import "${arg}"\n`);
		}
		// Add import at the start of the block so that goimports/goreturns can order them correctly
		return vscode.TextEdit.insert(new vscode.Position(lastImportSection.start + 1, 0), '\t"' + arg + '"\n');
	} else if (imports.length > 0) {
		// There are only single import declarations, add after the last one
		let lastSingleImport = imports[imports.length - 1].end;
		return vscode.TextEdit.insert(new vscode.Position(lastSingleImport + 1, 0), 'import "' + arg + '"\n');
	} else if (pkg && pkg.start >= 0) {
		// There are no import declarations, but there is a package declaration
		return vscode.TextEdit.insert(new vscode.Position(pkg.start + 1, 0), '\nimport (\n\t"' + arg + '"\n)\n');
	} else {
		// There are no imports and no package declaration - give up
		return null;
	}
}

export function addImport(arg: string) {
	let p = arg ? Promise.resolve(arg) : askUserForImport();
	p.then(imp => {
		let edit = getTextEditForAddImport(imp);
		if (edit) {
			vscode.window.activeTextEditor.edit(editBuilder => {
				editBuilder.insert(edit.range.start, edit.newText);
			});
		}
	});
}
