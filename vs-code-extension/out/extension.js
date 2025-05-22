"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = __importStar(require("vscode"));
const vscode_1 = require("vscode");
const child_process_1 = require("child_process");
const util_1 = require("util");
const diagnosticCollection = vscode.languages.createDiagnosticCollection('code-duplication');
const execPromise = (0, util_1.promisify)(child_process_1.exec);
function activate(context) {
    // Register a command to check for duplicates
    let checkDuplicates = vscode.commands.registerCommand('extension.checkDuplicates', async () => {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showWarningMessage('Please open a file to check for duplicates');
            return;
        }
        const document = activeEditor.document;
        try {
            // Extract all functions from the document
            const functions = extractFunctions(document);
            // Find duplicate functions
            const duplicates = findDuplicateFunctions(functions);
            // Create diagnostics for duplicates
            const diagnostics = [];
            duplicates.forEach((dup) => {
                diagnostics.push(new vscode_1.Diagnostic(dup.range, `Duplicate function found. Similar function '${dup.matchName}' exists at line ${dup.matchRange.start.line + 1}`, vscode.DiagnosticSeverity.Warning));
            });
            // Show diagnostics
            diagnosticCollection.set(document.uri, diagnostics);
            // Handle duplicate functions if found
            if (duplicates.length > 0) {
                // Start the interactive process to review each duplicate
                await reviewDuplicateFunctions(duplicates, document);
            }
            else {
                // Now check for the first code duplicate if no function duplicates were found
                const codeDuplicates = findNextCodeDuplicate(document);
                if (codeDuplicates.length > 0) {
                    // Add diagnostics for the first code duplicate
                    codeDuplicates.forEach((dup) => {
                        diagnostics.push(new vscode_1.Diagnostic(dup.range, `Duplicate code found. Similar code exists at line ${dup.matchRange.start.line + 1}`, vscode.DiagnosticSeverity.Warning));
                    });
                    // Update diagnostics
                    diagnosticCollection.set(document.uri, diagnostics);
                    vscode.window.showInformationMessage(`Duplicate code found. Would you like to review it?`, 'Yes', 'No').then(async (choice) => {
                        if (choice === 'Yes') {
                            await reviewDuplicateCode(codeDuplicates, document);
                        }
                    });
                }
                else {
                    // Extract all if statements from the document
                    const ifStatements = extractIfStatements(document);
                    // Find duplicate if statements
                    const ifDuplicates = findDuplicateIfStatements(ifStatements);
                    if (ifDuplicates.length > 0) {
                        // Add diagnostics for duplicate if statements
                        ifDuplicates.forEach((dup) => {
                            diagnostics.push(new vscode_1.Diagnostic(dup.range, `Duplicate if statement found. Similar if statement exists at line ${dup.matchRange.start.line + 1}`, vscode.DiagnosticSeverity.Warning));
                        });
                        // Update diagnostics
                        diagnosticCollection.set(document.uri, diagnostics);
                        // Start the interactive process to review each duplicate if statement
                        await reviewDuplicateIfStatements(ifDuplicates, document);
                    }
                    else {
                        vscode.window.showInformationMessage('No duplicate code found in the current file.');
                    }
                }
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`Error detecting duplicates: ${error.message || 'Unknown error'}`);
            console.error('Duplicate detection error:', error);
        }
    });
    // Register a command to extract duplicates to a function
    let extractDuplicatesCommand = vscode.commands.registerCommand('extension.extractDuplicates', async (document, diagnostics) => {
        if (!document || !diagnostics || diagnostics.length === 0)
            return;
        try {
            // Check if the diagnostic is for a duplicate function or code
            const functionDuplicates = [];
            const codeDuplicates = [];
            for (const diag of diagnostics) {
                const message = diag.message;
                const isFunctionDuplicate = message.includes('Duplicate function');
                const lineMatch = message.match(/line (\d+)/i);
                if (lineMatch) {
                    const matchLine = parseInt(lineMatch[1]) - 1;
                    if (isFunctionDuplicate) {
                        // Extract function name from message
                        const nameMatch = message.match(/function '([^']+)'/i);
                        const matchName = nameMatch ? nameMatch[1] : 'unknown';
                        functionDuplicates.push({
                            name: '',
                            range: diag.range,
                            matchName,
                            matchRange: new vscode_1.Range(new vscode_1.Position(matchLine, 0), new vscode_1.Position(matchLine + 10, 0) // Approximate
                            )
                        });
                    }
                    else {
                        codeDuplicates.push({
                            range: diag.range,
                            matchRange: new vscode_1.Range(new vscode_1.Position(matchLine, 0), new vscode_1.Position(matchLine + (diag.range.end.line - diag.range.start.line), 0))
                        });
                    }
                }
            }
            if (functionDuplicates.length > 0) {
                await reviewDuplicateFunctions(functionDuplicates, document);
            }
            else if (codeDuplicates.length > 0) {
                await reviewDuplicateCode(codeDuplicates, document);
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`Error extracting duplicates: ${error.message || 'Unknown error'}`);
            console.error('Error extracting duplicates:', error);
        }
    });
    // Register a code action provider
    const codeActionProvider = vscode.languages.registerCodeActionsProvider({
        scheme: 'file',
        language: '*',
        pattern: '**/*'
    }, {
        provideCodeActions(document, range, context, token) {
            const actions = [];
            const diagnostics = context.diagnostics.filter(d => d.source === 'code-duplication');
            if (diagnostics.length > 0) {
                const action = new vscode_1.CodeAction('Extract to new function', vscode_1.CodeActionKind.Refactor);
                action.command = {
                    title: 'Extract to new function',
                    command: 'extension.extractDuplicates',
                    arguments: [document, diagnostics]
                };
                actions.push(action);
            }
            return actions;
        }
    });
    context.subscriptions.push(checkDuplicates, extractDuplicatesCommand, codeActionProvider, diagnosticCollection);
}
exports.activate = activate;
function deactivate() {
    diagnosticCollection.clear();
    diagnosticCollection.dispose();
}
exports.deactivate = deactivate;
// Extract all functions from the document
function extractFunctions(document) {
    const text = document.getText();
    const functions = [];
    // Regular expression to find function declarations
    // This will match both named functions and arrow functions
    const functionRegex = /(?:function\s+([\w$]+)\s*\(([^)]*)\)|(?:const|let|var)\s+([\w$]+)\s*=\s*(?:function\s*\(([^)]*)\)|\(([^)]*)\)\s*=>))\s*{([^}]*)}/g;
    let match;
    while ((match = functionRegex.exec(text)) !== null) {
        // Extract function name and body
        const name = match[1] || match[3] || 'anonymous';
        const params = match[2] || match[4] || match[5] || '';
        const body = match[6] || '';
        // Get the range of the function
        const startPos = document.positionAt(match.index);
        const endPos = document.positionAt(match.index + match[0].length);
        const range = new vscode_1.Range(startPos, endPos);
        // Normalize the body to compare functions regardless of variable names
        const normalizedBody = normalizeCode(body);
        // Convert params string to array
        const paramsArray = params.split(',').map(p => p.trim()).filter(p => p.length > 0);
        functions.push({
            name,
            range,
            body,
            normalizedBody,
            params: paramsArray
        });
    }
    return functions;
}
// Extract all if statements from the document
function extractIfStatements(document) {
    const text = document.getText();
    const ifStatements = [];
    // Regular expressions to find if statements in different formats
    // This will match standard if statements with their conditions and bodies
    const standardIfRegex = /if\s*\(([^)]*)\)\s*{([^}]*)}/g;
    // This will match PHP-style if statements that might have else blocks
    const phpStyleIfRegex = /if\s*\(([^)]*)\)\s*{([\s\S]*?)(?:}\s*else\s*{|$)/g;
    // Process standard if statements
    let match;
    while ((match = standardIfRegex.exec(text)) !== null) {
        // Extract condition and body
        const condition = match[1] || '';
        const body = match[2] || '';
        // Skip empty or trivial if statements
        if (body.trim().length < 10)
            continue;
        // Get the range of the if statement
        const startPos = document.positionAt(match.index);
        const endPos = document.positionAt(match.index + match[0].length);
        const range = new vscode_1.Range(startPos, endPos);
        // Normalize the body to compare if statements regardless of variable names
        const normalizedBody = normalizeCodeForComparison(body);
        ifStatements.push({
            condition,
            range,
            body,
            normalizedBody
        });
    }
    // Process PHP-style if statements
    let phpMatch;
    while ((phpMatch = phpStyleIfRegex.exec(text)) !== null) {
        // Extract condition and body
        const condition = phpMatch[1] || '';
        let body = phpMatch[2] || '';
        // If the body contains the closing bracket of the if, trim it
        const closingBracketIndex = body.lastIndexOf('}');
        if (closingBracketIndex !== -1) {
            body = body.substring(0, closingBracketIndex);
        }
        // Skip empty or trivial if statements or ones we've already processed
        if (body.trim().length < 10)
            continue;
        // Check if this if statement is already in our list
        const phpMatchIndex = phpMatch.index; // Store index in a local variable
        const isDuplicate = ifStatements.some(stmt => {
            return Math.abs(document.positionAt(phpMatchIndex).line - stmt.range.start.line) < 5;
        });
        if (isDuplicate)
            continue;
        // Get the range of the if statement
        const startPos = document.positionAt(phpMatch.index);
        const endPos = document.positionAt(phpMatch.index + phpMatch[0].length);
        const range = new vscode_1.Range(startPos, endPos);
        // Normalize the body to compare if statements regardless of variable names
        const normalizedBody = normalizeCodeForComparison(body);
        ifStatements.push({
            condition,
            range,
            body,
            normalizedBody
        });
    }
    return ifStatements;
}
// Find duplicate functions in the document
function findDuplicateFunctions(functions) {
    const duplicates = [];
    // Compare each function with every other function
    for (let i = 0; i < functions.length; i++) {
        for (let j = i + 1; j < functions.length; j++) {
            const func1 = functions[i];
            const func2 = functions[j];
            // Skip if the functions have the same name (likely overloads)
            if (func1.name === func2.name)
                continue;
            // Compare the normalized bodies
            const similarity = calculateSimilarity(func1.normalizedBody, func2.normalizedBody);
            // If the similarity is high enough, consider them duplicates
            // Always mark the second function (func2) as the duplicate to be removed
            if (similarity > 0.9) { // 90% similarity threshold for functions
                duplicates.push({
                    name: func1.name,
                    range: func1.range,
                    matchName: func2.name,
                    matchRange: func2.range
                });
            }
        }
    }
    return duplicates;
}
// Find duplicate if statements in the document
function findDuplicateIfStatements(ifStatements) {
    const duplicates = [];
    // Compare each if statement with every other if statement
    for (let i = 0; i < ifStatements.length; i++) {
        for (let j = i + 1; j < ifStatements.length; j++) {
            const if1 = ifStatements[i];
            const if2 = ifStatements[j];
            // Compare the normalized bodies
            const similarity = calculateSimilarity(if1.normalizedBody, if2.normalizedBody);
            // If the similarity is high enough, consider them duplicates
            // Always mark the second if statement (if2) as the duplicate to be removed or refactored
            if (similarity > 0.9) { // 90% similarity threshold for if statements
                duplicates.push({
                    condition: if1.condition,
                    range: if1.range,
                    matchCondition: if2.condition,
                    matchRange: if2.range
                });
            }
        }
    }
    return duplicates;
}
// Keep track of processed duplicates to avoid showing the same duplicate twice
let processedDuplicates = [];
// Find the next duplicate code block in the document
function findNextCodeDuplicate(document) {
    const duplicates = [];
    const chunks = extractCodeChunks(document);
    // Compare each chunk with every other chunk
    for (let i = 0; i < chunks.length; i++) {
        for (let j = i + 1; j < chunks.length; j++) {
            const chunk1 = chunks[i];
            const chunk2 = chunks[j];
            // Skip if the ranges overlap
            if (rangesOverlap(chunk1.range, chunk2.range))
                continue;
            // Skip if this duplicate pair has already been processed
            if (isDuplicateProcessed(chunk1.range, chunk2.range))
                continue;
            // Normalize the code for comparison
            const normalized1 = normalizeCodeForComparison(chunk1.code);
            const normalized2 = normalizeCodeForComparison(chunk2.code);
            // Skip if the normalized code is too short
            if (normalized1.length < 30 || normalized2.length < 30)
                continue;
            // Calculate similarity
            const similarity = calculateSimilarity(normalized1, normalized2);
            // If the similarity is high enough, consider them duplicates
            if (similarity > 0.85) { // 85% similarity threshold for code blocks
                // Mark this duplicate as processed
                processedDuplicates.push({
                    start: chunk1.range.start.line,
                    end: chunk1.range.end.line,
                    matchStart: chunk2.range.start.line,
                    matchEnd: chunk2.range.end.line
                });
                duplicates.push({
                    range: chunk1.range,
                    matchRange: chunk2.range
                });
                // Return as soon as we find one duplicate
                return duplicates;
            }
        }
    }
    return duplicates;
}
// Find all duplicate code blocks in the document (used for diagnostics)
function findCodeDuplicates(document) {
    const duplicates = [];
    const chunks = extractCodeChunks(document);
    // Compare each chunk with every other chunk
    for (let i = 0; i < chunks.length; i++) {
        for (let j = i + 1; j < chunks.length; j++) {
            const chunk1 = chunks[i];
            const chunk2 = chunks[j];
            // Skip if the ranges overlap
            if (rangesOverlap(chunk1.range, chunk2.range))
                continue;
            // Normalize the code for comparison
            const normalized1 = normalizeCodeForComparison(chunk1.code);
            const normalized2 = normalizeCodeForComparison(chunk2.code);
            // Skip if the normalized code is too short
            if (normalized1.length < 30 || normalized2.length < 30)
                continue;
            // Calculate similarity
            const similarity = calculateSimilarity(normalized1, normalized2);
            // If the similarity is high enough, consider them duplicates
            if (similarity > 0.85) { // 85% similarity threshold for code blocks
                duplicates.push({
                    range: chunk1.range,
                    matchRange: chunk2.range
                });
            }
        }
    }
    return duplicates;
}
// Check if a duplicate has already been processed
function isDuplicateProcessed(range1, range2) {
    return processedDuplicates.some(pd => (pd.start === range1.start.line && pd.end === range1.end.line &&
        pd.matchStart === range2.start.line && pd.matchEnd === range2.end.line) ||
        (pd.start === range2.start.line && pd.end === range2.end.line &&
            pd.matchStart === range1.start.line && pd.matchEnd === range1.end.line));
}
// Review each duplicate function one by one
async function reviewDuplicateFunctions(duplicates, document) {
    // Create a copy of the array to avoid modifying the original during iteration
    const duplicatesToReview = [...duplicates];
    // Process each duplicate one at a time
    await processNextDuplicate(duplicatesToReview, document);
}
// Review each duplicate if statement one by one
async function reviewDuplicateIfStatements(duplicates, document) {
    // Create a copy of the array to avoid modifying the original during iteration
    const duplicatesToReview = [...duplicates];
    // Process each duplicate one at a time
    await processNextDuplicateIfStatement(duplicatesToReview, document);
}
// Store decoration types so we can clear them later
let functionHighlightDecoration;
let ifStatementHighlightDecoration;
let codeHighlightDecoration;
// Track the currently open difference webview panel (if any)
let diffPanel;
// Process the next duplicate in the queue
async function processNextDuplicate(duplicates, document) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document) {
        return;
    }
    // Clear any existing highlights if we're done
    if (duplicates.length === 0) {
        clearHighlights();
        diagnosticCollection.clear();
        if (diffPanel) {
            diffPanel.dispose();
            diffPanel = undefined;
        }
        vscode.window.showInformationMessage('Finished reviewing all duplicate functions.');
        return;
    }
    // Get the next duplicate to review
    const duplicate = duplicates[0];
    // Clear previous highlights first
    clearHighlights();
    // Navigate to the duplicate function
    editor.revealRange(duplicate.matchRange, vscode.TextEditorRevealType.InCenter);
    editor.selection = new vscode.Selection(duplicate.matchRange.start, duplicate.matchRange.end);
    // Create and apply highlight decoration
    functionHighlightDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(255, 0, 0, 0.2)',
        isWholeLine: true
    });
    editor.setDecorations(functionHighlightDecoration, [duplicate.matchRange]);
    // Show comparison in webview panel
    const originalCode = document.getText(duplicate.range);
    const duplicateCode = document.getText(duplicate.matchRange);
    const comparisonContent = `# Duplicate Function Comparison

## Original Function (${duplicate.name})

\`\`\`typescript
${originalCode}
\`\`\`

## Duplicate Function (${duplicate.matchName})

\`\`\`typescript
${duplicateCode}
\`\`\`

The duplicate function will be removed if you select 'Yes'.
`;
    // Dispose previous panel if open
    if (diffPanel) {
        diffPanel.dispose();
    }
    diffPanel = vscode.window.createWebviewPanel('duplicateComparison', 'Duplicate Function Comparison', vscode.ViewColumn.Beside, { enableScripts: false });
    diffPanel.webview.html = `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Duplicate Comparison</title>
        <style>
            body { font-family: sans-serif; padding: 20px; }
            pre { background-color:rgb(138, 129, 129); padding: 10px; border-radius: 5px; overflow: auto; }
            h1 { color: #333; }
            h2 { color: #666; }
        </style>
    </head>
    <body>
        ${comparisonContent.replace(/```typescript/g, '<pre>').replace(/```/g, '</pre>')}
    </body>
    </html>`;
    // Handle panel disposal
    diffPanel.onDidDispose(() => {
        diffPanel = undefined;
    });
    const choice = await vscode.window.showInformationMessage(`Duplicate function found: '${duplicate.matchName}' is similar to '${duplicate.name}'. Would you like to remove this duplicate? (Check the comparison in the side panel)`, { modal: true }, 'Yes', 'No', 'Skip All');
    // Clean up regardless of choice
    clearHighlights();
    if (diffPanel) {
        diffPanel.dispose();
        diffPanel = undefined;
    }
    if (choice === 'Yes') {
        await removeDuplicateFunction(duplicate.matchRange, document);
        duplicates.shift();
        await processNextDuplicate(duplicates, document);
    }
    else if (choice === 'No') {
        duplicates.shift();
        await processNextDuplicate(duplicates, document);
    }
    else if (choice === 'Skip All') {
        diagnosticCollection.clear();
        vscode.window.showInformationMessage('Skipped remaining duplicate functions.');
    }
}
// Process the next duplicate if statement in the queue
async function processNextDuplicateIfStatement(duplicates, document) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document) {
        return;
    }
    if (duplicates.length === 0) {
        clearHighlights();
        diagnosticCollection.clear();
        if (diffPanel) {
            diffPanel.dispose();
            diffPanel = undefined;
        }
        vscode.window.showInformationMessage('Finished reviewing all duplicate if statements.');
        return;
    }
    const duplicate = duplicates[0];
    clearHighlights();
    editor.revealRange(duplicate.matchRange, vscode.TextEditorRevealType.InCenter);
    editor.selection = new vscode.Selection(duplicate.matchRange.start, duplicate.matchRange.end);
    ifStatementHighlightDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(0, 128, 255, 0.2)',
        isWholeLine: true
    });
    editor.setDecorations(ifStatementHighlightDecoration, [duplicate.matchRange]);
    const originalCode = document.getText(duplicate.range);
    const duplicateCode = document.getText(duplicate.matchRange);
    const comparisonContent = `# Duplicate If Statement Comparison

## Original If Statement (condition: ${duplicate.condition})

\`\`\`typescript
${originalCode}
\`\`\`

## Duplicate If Statement (condition: ${duplicate.matchCondition})

\`\`\`typescript
${duplicateCode}
\`\`\`

The duplicate if statement will be removed if you select 'Yes'.
`;
    if (diffPanel) {
        diffPanel.dispose();
    }
    diffPanel = vscode.window.createWebviewPanel('duplicateComparison', 'Duplicate If Statement Comparison', vscode.ViewColumn.Beside, { enableScripts: false });
    diffPanel.webview.html = `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Duplicate Comparison</title>
        <style>
            body { font-family: sans-serif; padding: 20px; }
            pre { background-color: #f5f5f5; padding: 10px; border-radius: 5px; overflow: auto; }
            h1 { color: #333; }
            h2 { color: #666; }
        </style>
    </head>
    <body>
        ${comparisonContent.replace(/```typescript/g, '<pre>').replace(/```/g, '</pre>')}
    </body>
    </html>`;
    diffPanel.onDidDispose(() => {
        diffPanel = undefined;
    });
    const choice = await vscode.window.showInformationMessage(`Duplicate if statement found with condition: '${duplicate.matchCondition}'. Would you like to remove this duplicate? (Check the comparison in the side panel)`, { modal: true }, 'Yes', 'No', 'Skip All');
    clearHighlights();
    if (diffPanel) {
        diffPanel.dispose();
        diffPanel = undefined;
    }
    if (choice === 'Yes') {
        await removeDuplicateIfStatement(duplicate.matchRange, document);
        duplicates.shift();
        await processNextDuplicateIfStatement(duplicates, document);
    }
    else if (choice === 'No') {
        duplicates.shift();
        await processNextDuplicateIfStatement(duplicates, document);
    }
    else if (choice === 'Skip All') {
        diagnosticCollection.clear();
        vscode.window.showInformationMessage('Skipped remaining duplicate if statements.');
    }
}
// Function to clear all highlights
function clearHighlights() {
    if (functionHighlightDecoration) {
        functionHighlightDecoration.dispose();
        functionHighlightDecoration = undefined;
    }
    if (ifStatementHighlightDecoration) {
        ifStatementHighlightDecoration.dispose();
        ifStatementHighlightDecoration = undefined;
    }
    if (codeHighlightDecoration) {
        codeHighlightDecoration.dispose();
        codeHighlightDecoration = undefined;
    }
}
// Remove a specific duplicate function
async function removeDuplicateFunction(range, document) {
    try {
        // Make sure we get the entire function including the closing bracket
        const functionText = document.getText(range);
        const edit = new vscode_1.WorkspaceEdit();
        // Check if the function text ends with a closing bracket
        if (!functionText.trim().endsWith('}')) {
            // Find the closing bracket
            const text = document.getText();
            const startPos = document.offsetAt(range.start);
            let bracketCount = 0;
            let endPos = startPos;
            // Find the opening bracket first
            for (let i = startPos; i < text.length; i++) {
                if (text[i] === '{') {
                    bracketCount++;
                    break;
                }
            }
            // Now find the matching closing bracket
            for (let i = startPos; i < text.length; i++) {
                if (text[i] === '{') {
                    bracketCount++;
                }
                else if (text[i] === '}') {
                    bracketCount--;
                    if (bracketCount === 0) {
                        // Found the matching closing bracket
                        endPos = i + 1; // Include the closing bracket
                        break;
                    }
                }
            }
            // Create a new range that includes the entire function with closing bracket
            if (endPos > startPos) {
                const endPosition = document.positionAt(endPos);
                range = new vscode_1.Range(range.start, endPosition);
            }
        }
        // Remove the duplicate function
        edit.delete(document.uri, range);
        // Apply the edit
        const success = await vscode.workspace.applyEdit(edit);
        if (success) {
            vscode.window.showInformationMessage('Successfully removed duplicate function');
        }
        else {
            vscode.window.showErrorMessage('Failed to remove duplicate function');
        }
    }
    catch (error) {
        vscode.window.showErrorMessage(`Error removing duplicate: ${error.message || 'Unknown error'}`);
        console.error('Error removing duplicate:', error);
    }
}
// Remove a specific duplicate if statement
async function removeDuplicateIfStatement(range, document) {
    try {
        // Make sure we get the entire if statement including the closing bracket
        const ifStatementText = document.getText(range);
        const edit = new vscode_1.WorkspaceEdit();
        // Check if the if statement text ends with a closing bracket
        if (!ifStatementText.trim().endsWith('}')) {
            // Find the closing bracket
            const text = document.getText();
            const startPos = document.offsetAt(range.start);
            let bracketCount = 0;
            let endPos = startPos;
            // Find the opening bracket first
            for (let i = startPos; i < text.length; i++) {
                if (text[i] === '{') {
                    bracketCount++;
                    break;
                }
            }
            // Now find the matching closing bracket
            for (let i = startPos; i < text.length; i++) {
                if (text[i] === '{') {
                    bracketCount++;
                }
                else if (text[i] === '}') {
                    bracketCount--;
                    if (bracketCount === 0) {
                        // Found the matching closing bracket
                        endPos = i + 1; // Include the closing bracket
                        break;
                    }
                }
            }
            // Create a new range that includes the entire if statement with closing bracket
            if (endPos > startPos) {
                const endPosition = document.positionAt(endPos);
                range = new vscode_1.Range(range.start, endPosition);
            }
        }
        // Remove the duplicate if statement
        edit.delete(document.uri, range);
        // Apply the edit
        const success = await vscode.workspace.applyEdit(edit);
        if (success) {
            vscode.window.showInformationMessage('Successfully removed duplicate if statement');
        }
        else {
            vscode.window.showErrorMessage('Failed to remove duplicate if statement');
        }
    }
    catch (error) {
        vscode.window.showErrorMessage(`Error removing duplicate: ${error.message || 'Unknown error'}`);
        console.error('Error removing duplicate:', error);
    }
}
// Normalize code for comparison
function normalizeCodeForComparison(code) {
    return code
        // Normalize variable names
        .replace(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g, (match) => {
        // Don't replace keywords
        const keywords = ['if', 'else', 'for', 'while', 'switch', 'case', 'try', 'catch', 'finally',
            'return', 'const', 'let', 'var', 'function', 'true', 'false', 'null', 'undefined'];
        if (keywords.includes(match)) {
            return match;
        }
        return '__ID__';
    })
        // Normalize string literals
        .replace(/['"`].*?['"`]/g, '"__STR__"')
        // Normalize numeric literals
        .replace(/\b\d+\b/g, '__NUM__')
        // Remove whitespace
        .replace(/\s+/g, ' ')
        .trim();
}
// Review each duplicate code block one by one
async function reviewDuplicateCode(duplicates, document) {
    // Create a copy of the array to avoid modifying the original during iteration
    const duplicatesToReview = [...duplicates];
    // Process each duplicate one at a time
    await processNextDuplicateCode(duplicatesToReview, document);
}
// Process the next duplicate code block in the queue
async function processNextDuplicateCode(duplicates, document) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document) {
        return;
    }
    if (duplicates.length === 0) {
        // Find the next duplicate in the document
        const newDuplicates = findNextCodeDuplicate(document);
        if (newDuplicates.length > 0) {
            // Process the next found duplicate
            await processNextDuplicateCode(newDuplicates, document);
        }
        else {
            // No more duplicates found, clean up
            clearHighlights();
            diagnosticCollection.clear();
            if (diffPanel) {
                diffPanel.dispose();
                diffPanel = undefined;
            }
            vscode.window.showInformationMessage('Finished reviewing all duplicate code blocks.');
        }
        return;
    }
    const duplicate = duplicates[0];
    clearHighlights();
    editor.revealRange(duplicate.matchRange, vscode.TextEditorRevealType.InCenter);
    editor.selection = new vscode.Selection(duplicate.matchRange.start, duplicate.matchRange.end);
    codeHighlightDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(255, 165, 0, 0.2)',
        isWholeLine: true
    });
    editor.setDecorations(codeHighlightDecoration, [duplicate.matchRange]);
    const originalCode = document.getText(duplicate.range);
    const duplicateCode = document.getText(duplicate.matchRange);
    const comparisonContent = `# Duplicate Code Comparison

## Original Code (line ${duplicate.range.start.line + 1})

\`\`\`typescript
${originalCode}
\`\`\`

## Duplicate Code (line ${duplicate.matchRange.start.line + 1})

\`\`\`typescript
${duplicateCode}
\`\`\`

Both code blocks will be replaced with a function call if you select 'Yes'.
`;
    if (diffPanel) {
        diffPanel.dispose();
    }
    diffPanel = vscode.window.createWebviewPanel('duplicateComparison', 'Duplicate Code Comparison', vscode.ViewColumn.Beside, { enableScripts: false });
    diffPanel.webview.html = `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Duplicate Comparison</title>
        <style>
            body { font-family: sans-serif; padding: 20px; }
            pre { background-color: #f5f5f5; padding: 10px; border-radius: 5px; overflow: auto; }
            h1 { color: #333; }
            h2 { color: #666; }
        </style>
    </head>
    <body>
        ${comparisonContent.replace(/```typescript/g, '<pre>').replace(/```/g, '</pre>')}
    </body>
    </html>`;
    diffPanel.onDidDispose(() => {
        diffPanel = undefined;
    });
    const choice = await vscode.window.showInformationMessage(`Duplicate code found at line ${duplicate.matchRange.start.line + 1}. Would you like to extract it to a function? (Check the comparison in the side panel)`, { modal: true }, 'Yes', 'No', 'Skip All');
    clearHighlights();
    if (diffPanel) {
        diffPanel.dispose();
        diffPanel = undefined;
    }
    if (choice === 'Yes') {
        await extractDuplicateToFunction(duplicate, document);
        duplicates.shift();
        await processNextDuplicateCode(duplicates, document);
    }
    else if (choice === 'No') {
        duplicates.shift();
        await processNextDuplicateCode(duplicates, document);
    }
    else if (choice === 'Skip All') {
        diagnosticCollection.clear();
        vscode.window.showInformationMessage('Skipped remaining duplicate code blocks.');
    }
}
// Extract a specific duplicate code block to a function
async function extractDuplicateToFunction(duplicate, document) {
    try {
        // Create a workspace edit
        const edit = new vscode_1.WorkspaceEdit();
        // Extract the code fragment
        const code = document.getText(duplicate.matchRange);
        // Generate a meaningful function name
        const functionName = generateFunctionName(code);
        // Extract potential parameters
        const { paramList, modifiedCode } = extractPotentialParameters(code);
        // Create the new function
        const newFunction = `function ${functionName}(${paramList}) {
${modifiedCode}
}

`;
        // Find a good position to insert the function
        const insertPosition = new vscode_1.Position(0, 0); // Insert at the beginning of the file
        // Insert the new function
        edit.insert(document.uri, insertPosition, newFunction);
        // Replace the duplicate instances with function calls
        const functionCall = `${functionName}(${paramList ? '/* Add parameters here */' : ''});`;
        // Replace both instances
        edit.replace(document.uri, duplicate.range, functionCall);
        edit.replace(document.uri, duplicate.matchRange, functionCall);
        // Apply the edit
        const success = await vscode.workspace.applyEdit(edit);
        if (success) {
            vscode.window.showInformationMessage(`Successfully extracted duplicate code to function '${functionName}'`);
        }
        else {
            vscode.window.showErrorMessage('Failed to extract duplicate code to function');
        }
    }
    catch (error) {
        vscode.window.showErrorMessage(`Error extracting duplicate: ${error.message || 'Unknown error'}`);
        console.error('Error extracting duplicate:', error);
    }
}
// Helper functions
function extractCodeChunks(document) {
    const chunks = [];
    const lines = document.lineCount;
    // Process code in chunks of 5-10 lines for more meaningful duplication detection
    for (let i = 0; i < lines; i += 5) {
        // Use larger chunks to capture more meaningful duplicates
        const end = Math.min(i + 10, lines);
        if (end > i) { // Make sure we have at least one line
            try {
                const range = new vscode_1.Range(i, 0, end - 1, document.lineAt(end - 1).text.length);
                const code = document.getText(range).trim();
                // Only add non-empty chunks with meaningful content
                // Increased minimum length to avoid trivial duplicates
                if (code.length > 30 && !isCommentOnly(code) && hasCodeStructure(code)) {
                    chunks.push({ code, range });
                }
            }
            catch (e) {
                // Skip invalid ranges
                console.error('Error creating range:', e);
            }
        }
    }
    return chunks;
}
// Helper to check if a code chunk is only comments
function isCommentOnly(code) {
    const lines = code.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 0 &&
            !trimmed.startsWith('//') &&
            !trimmed.startsWith('/*') &&
            !trimmed.startsWith('*') &&
            !trimmed.startsWith('*/')) {
            return false;
        }
    }
    return true;
}
// Helper to check if code has meaningful structure worth extracting
function hasCodeStructure(code) {
    // Special case: If this is a complete function, it's always considered structured
    const isFunctionDefinition = /function\s+[\w_]+\s*\([^)]*\)\s*{[\s\S]*}/.test(code);
    if (isFunctionDefinition) {
        return true; // Functions always have structure
    }
    // Check if the code contains control structures or function calls
    // that would make it worth extracting
    const hasControlStructure = /\b(if|else|for|while|switch|try|catch)\b/.test(code);
    const hasFunctionCall = /\w+\s*\(.*\)/.test(code);
    const hasAssignment = /\w+\s*=\s*/.test(code);
    const hasReturn = /\breturn\b/.test(code);
    // Avoid single line statements or simple assignments
    const lineCount = code.split('\n').filter(line => line.trim().length > 0).length;
    // Code should have some complexity to be worth extracting
    return (lineCount >= 3) && (hasControlStructure || hasFunctionCall || (hasAssignment && hasReturn));
}
function findDuplicates(chunks) {
    const duplicates = [];
    const seen = new Map();
    // First, identify function chunks for special handling
    const functionChunks = [];
    const regularChunks = [];
    for (const chunk of chunks) {
        // Check if this chunk contains a complete function
        const functionMatch = chunk.code.match(/function\s+([\w_]+)\s*\([^)]*\)\s*{[\s\S]*}/i);
        if (functionMatch) {
            // This is a function, normalize its body for comparison
            const normalizedBody = normalizeCode(chunk.code);
            functionChunks.push({ ...chunk, normalizedBody });
        }
        else {
            regularChunks.push(chunk);
        }
    }
    // First pass: compare functions with each other (special handling for duplicate functions)
    for (let i = 0; i < functionChunks.length; i++) {
        const chunk = functionChunks[i];
        // Skip if this function has already been matched
        if (duplicates.some(d => rangesEqual(d.range, chunk.range)))
            continue;
        for (let j = i + 1; j < functionChunks.length; j++) {
            const otherChunk = functionChunks[j];
            // Skip if already matched
            if (duplicates.some(d => rangesEqual(d.range, otherChunk.range)))
                continue;
            // Compare function bodies
            const similarity = calculateSimilarity(chunk.normalizedBody, otherChunk.normalizedBody);
            if (similarity > 0.9) { // Higher threshold for functions (90%)
                duplicates.push({
                    range: chunk.range,
                    matchRange: otherChunk.range
                });
                break; // Found a match for this function
            }
        }
    }
    // Second pass: process regular chunks
    for (let i = 0; i < regularChunks.length; i++) {
        const chunk = regularChunks[i];
        // Skip if this chunk has already been matched
        if (duplicates.some(d => rangesEqual(d.range, chunk.range)))
            continue;
        // Skip short chunks (likely not meaningful duplicates)
        if (chunk.code.length < 50)
            continue;
        // Normalize the code for better comparison
        const normalizedCode = normalizeCode(chunk.code);
        // Skip if normalized code is too short
        if (normalizedCode.length < 30)
            continue;
        // Calculate a similarity score for fuzzy matching
        let bestMatch = null;
        let highestSimilarity = 0;
        // Check for similar code (not just exact matches)
        for (const [key, value] of seen.entries()) {
            // Skip if ranges overlap
            if (rangesOverlap(chunk.range, value.range))
                continue;
            const similarity = calculateSimilarity(normalizedCode, key);
            if (similarity > 0.85 && similarity > highestSimilarity) { // 85% similarity threshold
                highestSimilarity = similarity;
                bestMatch = value;
            }
        }
        if (bestMatch) {
            duplicates.push({
                range: chunk.range,
                matchRange: bestMatch.range
            });
        }
        else {
            seen.set(normalizedCode, chunk);
        }
    }
    // Filter out duplicates that are subsets of other duplicates
    return filterSubsetDuplicates(duplicates);
}
// Helper to normalize code for comparison
function normalizeCode(code) {
    // Special handling for function bodies - extract just the function body for better comparison
    const functionBodyMatch = code.match(/function\s+[\w_]+\s*\([^)]*\)\s*{([\s\S]*)}/i);
    if (functionBodyMatch) {
        // If this is a complete function, extract just the body for comparison
        const functionBody = functionBodyMatch[1].trim();
        return normalizeCodeContent(functionBody);
    }
    return normalizeCodeContent(code);
}
// Helper to normalize the actual code content
function normalizeCodeContent(code) {
    return code
        // Normalize all identifiers (variable names, function names, etc.)
        .replace(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g, (match) => {
        // Don't replace keywords
        const keywords = ['if', 'else', 'for', 'while', 'switch', 'case', 'try', 'catch', 'finally',
            'return', 'const', 'let', 'var', 'function', 'true', 'false', 'null', 'undefined'];
        if (keywords.includes(match)) {
            return match;
        }
        return '__ID__';
    })
        // Preserve control structure keywords
        .replace(/\b(if|else|for|while|switch|case|try|catch|finally)\b\s*\([^)]*\)/g, (match) => {
        // Keep the structure but normalize the content
        return match.replace(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g, (m) => {
            if (['if', 'else', 'for', 'while', 'switch', 'case', 'try', 'catch', 'finally'].includes(m)) {
                return m;
            }
            return '__ID__';
        });
    })
        // Normalize function declarations completely (including name)
        .replace(/function\s+[\w_]+\s*\([^)]*\)/g, 'function __FUNC__(__PARAMS__)')
        // Normalize all function/method calls
        .replace(/\b[\w_]+\s*\([^)]*\)/g, '__CALL__(__PARAMS__)')
        // Remove all whitespace differences
        .replace(/\s+/g, ' ')
        // Normalize string literals
        .replace(/['"`].*?['"`]/g, '"__STR__"')
        // Normalize numeric literals
        .replace(/\b\d+\b/g, '__NUM__')
        .trim();
}
// Helper to calculate similarity between two strings
function calculateSimilarity(str1, str2) {
    // Simple implementation of Levenshtein distance for string similarity
    const len1 = str1.length;
    const len2 = str2.length;
    // If the strings are too different in length, they're probably not similar
    if (Math.abs(len1 - len2) > Math.min(len1, len2) * 0.3) {
        return 0;
    }
    const dp = Array(len1 + 1)
        .fill(null)
        .map(() => Array(len2 + 1).fill(0));
    for (let i = 0; i <= len1; i++)
        dp[i][0] = i;
    for (let j = 0; j <= len2; j++)
        dp[0][j] = j;
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, // deletion
            dp[i][j - 1] + 1, // insertion
            dp[i - 1][j - 1] + cost // substitution
            );
        }
    }
    // Convert distance to similarity score (0 to 1)
    const maxLen = Math.max(len1, len2);
    return maxLen === 0 ? 1 : 1 - dp[len1][len2] / maxLen;
}
// Helper to check if two ranges overlap
function rangesOverlap(range1, range2) {
    return ((range1.start.line <= range2.end.line && range1.end.line >= range2.start.line) ||
        (range2.start.line <= range1.end.line && range2.end.line >= range1.start.line));
}
// Helper to check if two ranges are equal
function rangesEqual(range1, range2) {
    return (range1.start.line === range2.start.line &&
        range1.start.character === range2.start.character &&
        range1.end.line === range2.end.line &&
        range1.end.character === range2.end.character);
}
// Helper to filter out duplicates that are subsets of other duplicates
function filterSubsetDuplicates(duplicates) {
    const result = [];
    for (let i = 0; i < duplicates.length; i++) {
        let isSubset = false;
        const current = duplicates[i];
        for (let j = 0; j < duplicates.length; j++) {
            if (i === j)
                continue;
            const other = duplicates[j];
            if (isRangeSubset(current.range, other.range) &&
                isRangeSubset(current.matchRange, other.matchRange)) {
                isSubset = true;
                break;
            }
        }
        if (!isSubset) {
            result.push(current);
        }
    }
    return result;
}
// Helper to check if one range is a subset of another
function isRangeSubset(range1, range2) {
    return ((range1.start.line >= range2.start.line && range1.end.line <= range2.end.line) ||
        (range1.start.line <= range2.start.line && range1.end.line >= range2.end.line));
}
// Helper to generate a meaningful function name based on the content
function generateFunctionName(code) {
    // Try to extract meaningful words from the code
    const words = code.match(/\b[A-Za-z][A-Za-z0-9]*\b/g) || [];
    // Filter out common keywords and short words
    const keywords = ['function', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'return', 'true', 'false'];
    const meaningfulWords = words.filter(word => !keywords.includes(word.toLowerCase()) && word.length > 2);
    if (meaningfulWords.length > 0) {
        // Use the first 1-2 meaningful words
        const base = meaningfulWords.slice(0, 2).join('');
        return `extracted${base.charAt(0).toUpperCase() + base.slice(1)}`;
    }
    // Fallback to a generic name with random number
    return `extractedFunction${Math.floor(Math.random() * 1000)}`;
}
// Helper to determine if code is worth extracting to a function
function isWorthExtracting(code, document) {
    // Special case: If this is a complete function, it's always worth extrac