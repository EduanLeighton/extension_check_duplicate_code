import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as acorn from 'acorn';
import { simple as walkSimple } from 'acorn-walk';
import { TextDocument, Range, Diagnostic, DiagnosticCollection, CodeAction, CodeActionKind, WorkspaceEdit, Position } from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import parser from "php-parser";

const diagnosticCollection = vscode.languages.createDiagnosticCollection('code-duplication');
const execPromise = promisify(exec);

// Interface for function information
interface FunctionInfo {
    name: string;
    range: Range;
    body: string;
    normalizedBody: string;
    params: string[];
}

// Interface for if statement information
interface IfStatementInfo {
    condition: string;
    range: Range;
    body: string;
    normalizedBody: string;
}

// Interface for duplicate function
interface DuplicateFunction {
    name: string;
    range: Range;
    matchName: string;
    matchRange: Range;
}

// Interface for duplicate if statement
interface DuplicateIfStatement {
    condition: string;
    range: Range;
    matchCondition: string;
    matchRange: Range;
}

// Interface for duplicate code
interface DuplicateCode {
    range: Range;
    matchRange: Range;
}

export function activate(context: vscode.ExtensionContext) {
    let checkDuplicates = vscode.commands.registerCommand('extension.checkDuplicates', async () => {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showWarningMessage('Please open a file to check for duplicates');
            return;
        }

        const document = activeEditor.document;
        const diagnostics: Diagnostic[] = [];

        try {
            const functions = extractFunctions(document);
            const functionDuplicates = findDuplicateFunctions(functions);

            const codeDuplicates = findNextCodeDuplicate(document);
            const ifStatements = extractIfStatements(document);
            const ifDuplicates = findDuplicateIfStatements(ifStatements);

            // Create diagnostics for function duplicates
            functionDuplicates.forEach((dup: DuplicateFunction) => {
                diagnostics.push(new Diagnostic(
                    dup.range,
                    `Duplicate function found. Similar function '${dup.matchName}' exists at line ${dup.matchRange.start.line + 1}`,
                    vscode.DiagnosticSeverity.Warning
                ));
            });

            // Create diagnostics for code block duplicates
            codeDuplicates.forEach((dup: DuplicateCode) => {
                diagnostics.push(new Diagnostic(
                    dup.range,
                    `Duplicate code found. Similar code exists at line ${dup.matchRange.start.line + 1}`,
                    vscode.DiagnosticSeverity.Warning
                ));
            });

            // Create diagnostics for if statement duplicates
            ifDuplicates.forEach((dup: DuplicateIfStatement) => {
                diagnostics.push(new Diagnostic(
                    dup.range,
                    `Duplicate if statement found. Similar if statement exists at line ${dup.matchRange.start.line + 1}`,
                    vscode.DiagnosticSeverity.Warning
                ));
            });

            // Set diagnostics
            diagnosticCollection.set(document.uri, diagnostics);

            const originalText = document.getText();

            if (functionDuplicates.length || codeDuplicates.length || ifDuplicates.length) {
                const choices = [];
                if (functionDuplicates.length) choices.push('Functions');
                if (codeDuplicates.length) choices.push('Code');
                if (ifDuplicates.length) choices.push('If Statements');
                choices.push('All', 'Skip');

                const choice = await vscode.window.showQuickPick(choices, {
                    placeHolder: 'Duplicate content found. What would you like to review?'
                });

                if (!choice || choice === 'Skip') return;

                // Clone document text to reset after each pass if needed
                let updatedText = originalText;

                // Helper to refresh document state
                const refreshDocumentState = () => {
                    const edit = new vscode.WorkspaceEdit();
                    const fullRange = new Range(
                        document.positionAt(0),
                        document.positionAt(document.getText().length)
                    );
                    edit.replace(document.uri, fullRange, updatedText);
                    return vscode.workspace.applyEdit(edit);
                };

                const cleanupStates = async () => {
                    try {
                        // Save the document first
                        await vscode.window.activeTextEditor?.document.save();
                        
                        // Clear all temporary variables
                        updatedText = '';
                        
                        clearHighlights();
                        diagnosticCollection.clear();
                        
                        // Close any open diff panel
                        if (diffPanel) {
                            diffPanel.dispose();
                            diffPanel = undefined;
                        }
                        
                        // Clear processed duplicates for the current type
                        clearProcessedDuplicates();
                        
                        // Reload the document to ensure we have the latest content
                        const doc = await vscode.workspace.openTextDocument(document.uri);
                        await vscode.window.showTextDocument(doc);
                    } catch (error) {
                        console.error('Error during cleanup:', error);
                        throw error;
                    }
                };

                const reviewAndRefresh = async (reviewFn: Function, findFn: Function, type: string) => {
                    try {
                        // Clear previously processed duplicates for this type
                        clearProcessedDuplicates(type);
                        
                        const reloadedText = document.getText();
                        const newItems = findFn(reloadedText);
                        if (newItems.length > 0) {
                            // Mark all items as processed for this type
                            newItems.forEach((item: any) => {
                                if (item.range && item.matchRange) {
                                    processedDuplicates.push({
                                        start: item.range.start.line,
                                        end: item.range.end.line,
                                        matchStart: item.matchRange.start.line,
                                        matchEnd: item.matchRange.end.line,
                                        type: type
                                    });
                                }
                            });
                            
                            await reviewFn(newItems, document);
                            updatedText = document.getText(); // capture post-edit
                            await refreshDocumentState();     // reload and re-analyze
                        }
                        return true;
                    } catch (error) {
                        console.error(`Error during ${type} review:`, error);
                        return false;
                    }
                };

                try {
                    let success = true;
                    
                    if (choice === 'Functions' || choice === 'All') {
                        success = await reviewAndRefresh(reviewDuplicateFunctions, 
                            () => findDuplicateFunctions(extractFunctions(document)), 'functions');
                    }

                    if (success && (choice === 'Code' || choice === 'All')) {
                        success = await reviewAndRefresh(reviewDuplicateCode, 
                            () => findNextCodeDuplicate(document), 'code');
                    }

                    if (success && (choice === 'If Statements' || choice === 'All')) {
                        success = await reviewAndRefresh(reviewDuplicateIfStatements, 
                            () => findDuplicateIfStatements(extractIfStatements(document)), 'if_statements');
                    }

                    // Final cleanup regardless of success/failure
                    await cleanupStates();
                    
                } catch (error) {
                    console.error('Error during review process:', error);
                    await cleanupStates();
                    throw error;
                }
            } else {
                vscode.window.showInformationMessage('No duplicate functions, code, or if statements found in the current file.');
            }

        } catch (error: any) {
            vscode.window.showErrorMessage(`Error detecting duplicates: ${error.message || 'Unknown error'}`);
            console.error('Duplicate detection error:', error);
        }
    });

    let extractDuplicatesCommand = vscode.commands.registerCommand('extension.extractDuplicates', async (document: TextDocument, diagnostics: Diagnostic[]) => {
        if (!document || !diagnostics || diagnostics.length === 0) return;

        try {
            const functionDuplicates: DuplicateFunction[] = [];
            const codeDuplicates: DuplicateCode[] = [];

            for (const diag of diagnostics) {
                const message = diag.message;
                const isFunctionDuplicate = message.includes('Duplicate function');
                const lineMatch = message.match(/line (\d+)/i);

                if (lineMatch) {
                    const matchLine = parseInt(lineMatch[1]) - 1;
                    const matchRange = new Range(
                        new Position(matchLine, 0),
                        new Position(matchLine + (diag.range.end.line - diag.range.start.line), 0)
                    );

                    if (isFunctionDuplicate) {
                        const nameMatch = message.match(/function '([^']+)'/i);
                        const matchName = nameMatch ? nameMatch[1] : 'unknown';

                        functionDuplicates.push({
                            name: '',
                            range: diag.range,
                            matchName,
                            matchRange
                        });
                    } else {
                        codeDuplicates.push({
                            range: diag.range,
                            matchRange
                        });
                    }
                }
            }

            if (functionDuplicates.length > 0) {
                await reviewDuplicateFunctions(functionDuplicates, document);
            }

            if (codeDuplicates.length > 0) {
                await reviewDuplicateCode(codeDuplicates, document);
            }

        } catch (error: any) {
            vscode.window.showErrorMessage(`Error extracting duplicates: ${error.message || 'Unknown error'}`);
            console.error('Error extracting duplicates:', error);
        }
    });

    const codeActionProvider = vscode.languages.registerCodeActionsProvider({
        scheme: 'file',
        language: '*',
        pattern: '**/*'
    }, {
        provideCodeActions(document, range, context, token) {
            const actions: CodeAction[] = [];
            const diagnostics = context.diagnostics.filter(d => d.source === 'code-duplication');
            if (diagnostics.length > 0) {
                const action = new CodeAction('Extract to new function', CodeActionKind.Refactor);
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

    context.subscriptions.push(
        checkDuplicates,
        extractDuplicatesCommand,
        codeActionProvider,
        diagnosticCollection
    );
}

export function deactivate() {
    diagnosticCollection.clear();
    diagnosticCollection.dispose();
}

const phpEngine = new parser.Engine({
    parser: { php7: true },
    ast: { withPositions: true }
});

function isPHPFile(filePath: string): boolean {
    return filePath.endsWith('.php');
}

function isJSOrTSFile(filePath: string): boolean {
    return filePath.endsWith('.js') || filePath.endsWith('.ts');
}

function extractFunctions(document: TextDocument): FunctionInfo[] {
    const text = document.getText();
    const functions: FunctionInfo[] = [];

    if (text.includes('<?php')) {
        // PHP parsing
        const ast = phpEngine.parseCode(text, "unknown.php");


        const walk = (node: any) => {
            if (!node) return;
            if (Array.isArray(node)) {
                node.forEach(walk);
            } else if (node.kind === 'function') {
                const name = node.name.name || 'anonymous';
                const params = node.arguments.map((p: any) => p.name);
                const body = text.slice(node.body.loc.start.offset, node.body.loc.end.offset);
                const normalizedBody = normalizeCode(body);
                const startPos = document.positionAt(node.loc.start.offset);
                const endPos = document.positionAt(node.loc.end.offset);
                const range = new Range(startPos, endPos);
                functions.push({ name, range, body, normalizedBody, params });
            }
            for (const key in node) {
                if (typeof node[key] === 'object') walk(node[key]);
            }
        };

        walk(ast);
    } else {
        // JS/TS parsing
        const ast = acorn.parse(text, { ecmaVersion: "latest", sourceType: "module" });

        walkSimple(ast, {
            FunctionDeclaration(node: any) {
                const name = node.id?.name || "anonymous";
                const params = node.params.map((p: any) => text.slice(p.start, p.end));
                const body = text.slice(node.body.start + 1, node.body.end - 1);
                const normalizedBody = normalizeCode(body);
                const range = new Range(document.positionAt(node.start), document.positionAt(node.end));
                functions.push({ name, range, body, normalizedBody, params });
            },
            VariableDeclaration(node: any) {
                for (const decl of node.declarations) {
                    const init = decl.init;
                    if (
                        init &&
                        (init.type === "FunctionExpression" || init.type === "ArrowFunctionExpression")
                    ) {
                        const name = decl.id.name || "anonymous";
                        const params = init.params.map((p: any) => text.slice(p.start, p.end));
                        const body =
                            init.body.type === "BlockStatement"
                                ? text.slice(init.body.start + 1, init.body.end - 1)
                                : text.slice(init.body.start, init.body.end);
                        const normalizedBody = normalizeCode(body);
                        const range = new Range(document.positionAt(init.start), document.positionAt(init.end));
                        functions.push({ name, range, body, normalizedBody, params });
                    }
                }
            }
        });
    }

    return functions;
}

function extractIfStatements(document: TextDocument): IfStatementInfo[] {
    const text = document.getText();
    const ifStatements: IfStatementInfo[] = [];

    if (text.includes('<?php')) {
        const ast = phpEngine.parseCode(text, "unknown.php");


        const walk = (node: any) => {
            if (!node) return;
            if (Array.isArray(node)) {
                node.forEach(walk);
            } else if (node.kind === 'if') {
                const condition = text.slice(node.test.loc.start.offset, node.test.loc.end.offset);
                const body = node.body ? text.slice(node.body.loc.start.offset, node.body.loc.end.offset) : '';
                if (body.trim().length < 10) return;

                const range = new Range(
                    document.positionAt(node.loc.start.offset),
                    document.positionAt(node.loc.end.offset)
                );
                const normalizedBody = normalizeCodeForComparison(body);
                ifStatements.push({ condition, range, body, normalizedBody });
            }
            for (const key in node) {
                if (typeof node[key] === 'object') walk(node[key]);
            }
        };

        walk(ast);
    } else {
        const ast = acorn.parse(text, { ecmaVersion: "latest", sourceType: "module" });

        walkSimple(ast, {
            IfStatement(node: any) {
                const condition = text.slice(node.test.start, node.test.end);
                const body = text.slice(node.consequent.start, node.consequent.end);
                if (body.trim().length < 10) return;

                const range = new Range(
                    document.positionAt(node.start),
                    document.positionAt(node.end)
                );
                const normalizedBody = normalizeCodeForComparison(body);
                ifStatements.push({ condition, range, body, normalizedBody });
            }
        });
    }

    return ifStatements;
}

// Find duplicate functions in the document
function findDuplicateFunctions(functions: FunctionInfo[]): DuplicateFunction[] {
    const duplicates: DuplicateFunction[] = [];
    
    // Compare each function with every other function
    for (let i = 0; i < functions.length; i++) {
        for (let j = i + 1; j < functions.length; j++) {
            const func1 = functions[i];
            const func2 = functions[j];
            
            // Skip if the functions have the same name (likely overloads)
            if (func1.name === func2.name) continue;
            
            // Compare the normalized bodies
            const similarity = calculateSimilarity(func1.normalizedBody, func2.normalizedBody);
            
            // If the similarity is high enough, consider them duplicates
            // Always mark the second function (func2) as the duplicate to be removed
            if (similarity > 0.95) { // 90% similarity threshold for functions
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
function findDuplicateIfStatements(ifStatements: IfStatementInfo[]): DuplicateIfStatement[] {
    const duplicates: DuplicateIfStatement[] = [];
    
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
let processedDuplicates: { start: number, end: number, matchStart: number, matchEnd: number, type: string }[] = [];

// Function to clear processed duplicates for a specific type
function clearProcessedDuplicates(type?: string) {
    if (type) {
        processedDuplicates = processedDuplicates.filter(d => d.type !== type);
    } else {
        processedDuplicates = [];
    }
}

// Find the next duplicate code block in the document
function findNextCodeDuplicate(document: TextDocument): DuplicateCode[] {
    const duplicates: DuplicateCode[] = [];
    const chunks = extractCodeChunks(document);
    
    // Compare each chunk with every other chunk
    for (let i = 0; i < chunks.length; i++) {
        for (let j = i + 1; j < chunks.length; j++) {
            const chunk1 = chunks[i];
            const chunk2 = chunks[j];
            
            // Skip if the ranges overlap
            if (rangesOverlap(chunk1.range, chunk2.range)) continue;
            
            // Skip if this duplicate pair has already been processed
            if (isDuplicateProcessed(chunk1.range, chunk2.range)) continue;
            
            // Normalize the code for comparison
            const normalized1 = normalizeCodeForComparison(chunk1.code);
            const normalized2 = normalizeCodeForComparison(chunk2.code);
            
            // Skip if the normalized code is too short
            if (normalized1.length < 30 || normalized2.length < 30) continue;
            
            // Calculate similarity
            const similarity = calculateSimilarity(normalized1, normalized2);
            
            // If the similarity is high enough, consider them duplicates
            if (similarity > 0.85) { // 85% similarity threshold for code blocks
                // Mark this duplicate as processed
                processedDuplicates.push({
                    start: chunk1.range.start.line,
                    end: chunk1.range.end.line,
                    matchStart: chunk2.range.start.line,
                    matchEnd: chunk2.range.end.line,
                    type: 'code'  // Add the type for code duplicates
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

// Check if a duplicate has already been processed
function isDuplicateProcessed(range1: Range, range2: Range, type?: string): boolean {
    const duplicatesToCheck = type 
        ? processedDuplicates.filter(d => d.type === type)
        : processedDuplicates;
        
    return duplicatesToCheck.some(d => 
        (d.start === range1.start.line && d.end === range1.end.line && 
         d.matchStart === range2.start.line && d.matchEnd === range2.end.line) ||
        (d.start === range2.start.line && d.end === range2.end.line && 
         d.matchStart === range1.start.line && d.matchEnd === range1.end.line)
    );
}

// Review each duplicate function one by one
async function reviewDuplicateFunctions(duplicates: DuplicateFunction[], document: TextDocument): Promise<void> {
    // Create a copy of the array to avoid modifying the original during iteration
    const duplicatesToReview = [...duplicates];
    
    // Process each duplicate one at a time
    await processNextDuplicate(duplicatesToReview, document);
}

// Review each duplicate if statement one by one
async function reviewDuplicateIfStatements(duplicates: DuplicateIfStatement[], document: TextDocument): Promise<void> {
    // Create a copy of the array to avoid modifying the original during iteration
    const duplicatesToReview = [...duplicates];
    
    // Process each duplicate one at a time
    await processNextDuplicateIfStatement(duplicatesToReview, document);
}

// Store decoration types so we can clear them later
let functionHighlightDecoration: vscode.TextEditorDecorationType | undefined;
let ifStatementHighlightDecoration: vscode.TextEditorDecorationType | undefined;
let codeHighlightDecoration: vscode.TextEditorDecorationType | undefined;

// Track the currently open difference webview panel (if any)
let diffPanel: vscode.WebviewPanel | undefined;

// Process the next duplicate in the queue
async function processNextDuplicate(duplicates: DuplicateFunction[], document: TextDocument): Promise<void> {
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
    editor.selection = new vscode.Selection(
        duplicate.matchRange.start,
        duplicate.matchRange.end
    );
    
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
    
    diffPanel = vscode.window.createWebviewPanel(
        'duplicateComparison',
        'Duplicate Function Comparison',
        vscode.ViewColumn.Beside,
        { enableScripts: false }
    );
    
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
    
    const choice = await vscode.window.showInformationMessage(
        `Duplicate function found: '${duplicate.matchName}' is similar to '${duplicate.name}'. Would you like to remove this duplicate? (Check the comparison in the side panel)`,
        { modal: true },
        'Yes', 'No', 'Skip All'
    );
    
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
    } else if (choice === 'No') {
        duplicates.shift();
        await processNextDuplicate(duplicates, document);
    } else if (choice === 'Skip All') {
        diagnosticCollection.clear();
        vscode.window.showInformationMessage('Skipped remaining duplicate functions.');
    }
}

// Process the next duplicate if statement in the queue
async function processNextDuplicateIfStatement(duplicates: DuplicateIfStatement[], document: TextDocument): Promise<void> {
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
    editor.selection = new vscode.Selection(
        duplicate.matchRange.start,
        duplicate.matchRange.end
    );
    
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
    
    diffPanel = vscode.window.createWebviewPanel(
        'duplicateComparison',
        'Duplicate If Statement Comparison',
        vscode.ViewColumn.Beside,
        { enableScripts: false }
    );
    
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
    
    const choice = await vscode.window.showInformationMessage(
        `Duplicate if statement found with condition: '${duplicate.matchCondition}'. Would you like to remove this duplicate? (Check the comparison in the side panel)`,
        { modal: true },
        'Yes', 'No', 'Skip All'
    );
    
    clearHighlights();
    if (diffPanel) {
        diffPanel.dispose();
        diffPanel = undefined;
    }
    
    if (choice === 'Yes') {
        await removeDuplicateIfStatement(duplicate.matchRange, document);
        duplicates.shift();
        await processNextDuplicateIfStatement(duplicates, document);
    } else if (choice === 'No') {
        duplicates.shift();
        await processNextDuplicateIfStatement(duplicates, document);
    } else if (choice === 'Skip All') {
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
async function removeDuplicateFunction(range: Range, document: TextDocument): Promise<void> {
    try {
        // Make sure we get the entire function including the closing bracket
        const functionText = document.getText(range);
        const edit = new WorkspaceEdit();
        
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
                } else if (text[i] === '}') {
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
                range = new Range(range.start, endPosition);
            }
        }
        
        // Remove the duplicate function
        edit.delete(document.uri, range);
        
        // Apply the edit
        const success = await vscode.workspace.applyEdit(edit);
        
        if (success) {
            vscode.window.showInformationMessage('Successfully removed duplicate function');
        } else {
            vscode.window.showErrorMessage('Failed to remove duplicate function');
        }
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error removing duplicate: ${error.message || 'Unknown error'}`);
        console.error('Error removing duplicate:', error);
    }
}

// Remove a specific duplicate if statement
async function removeDuplicateIfStatement(range: Range, document: TextDocument): Promise<void> {
    try {
        // Make sure we get the entire if statement including the closing bracket
        const ifStatementText = document.getText(range);
        const edit = new WorkspaceEdit();
        
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
                } else if (text[i] === '}') {
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
                range = new Range(range.start, endPosition);
            }
        }
        
        // Remove the duplicate if statement
        edit.delete(document.uri, range);
        
        // Apply the edit
        const success = await vscode.workspace.applyEdit(edit);
        
        if (success) {
            vscode.window.showInformationMessage('Successfully removed duplicate if statement');
        } else {
            vscode.window.showErrorMessage('Failed to remove duplicate if statement');
        }
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error removing duplicate: ${error.message || 'Unknown error'}`);
        console.error('Error removing duplicate:', error);
    }
}

// Normalize code for comparison
function normalizeCodeForComparison(code: string): string {
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
async function reviewDuplicateCode(duplicates: DuplicateCode[], document: TextDocument): Promise<void> {
    // Create a copy of the array to avoid modifying the original during iteration
    const duplicatesToReview = [...duplicates];
    
    // Process each duplicate one at a time
    await processNextDuplicateCode(duplicatesToReview, document);
}

// Process the next duplicate code block in the queue
async function processNextDuplicateCode(duplicates: DuplicateCode[], document: TextDocument): Promise<void> {
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
        } else {
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
    editor.selection = new vscode.Selection(
        duplicate.matchRange.start,
        duplicate.matchRange.end
    );
    
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
    
    diffPanel = vscode.window.createWebviewPanel(
        'duplicateComparison',
        'Duplicate Code Comparison',
        vscode.ViewColumn.Beside,
        { enableScripts: false }
    );
    
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
    
    const choice = await vscode.window.showInformationMessage(
        `Duplicate code found at line ${duplicate.matchRange.start.line + 1}. Would you like to extract it to a function? (Check the comparison in the side panel)`,
        { modal: true },
        'Yes', 'No', 'Skip All'
    );
    
    clearHighlights();
    if (diffPanel) {
        diffPanel.dispose();
        diffPanel = undefined;
    }
    
    if (choice === 'Yes') {
        await extractDuplicateToFunction(duplicate, document);
        duplicates.shift();
        await processNextDuplicateCode(duplicates, document);
    } else if (choice === 'No') {
        duplicates.shift();
        await processNextDuplicateCode(duplicates, document);
    } else if (choice === 'Skip All') {
        diagnosticCollection.clear();
        vscode.window.showInformationMessage('Skipped remaining duplicate code blocks.');
    }
}

// Extract a specific duplicate code block to a function
async function extractDuplicateToFunction(duplicate: DuplicateCode, document: TextDocument): Promise<void> {
    try {
        // Create a workspace edit
        const edit = new WorkspaceEdit();
        
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
        const insertPosition = new Position(0, 0); // Insert at the beginning of the file
        
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
        } else {
            vscode.window.showErrorMessage('Failed to extract duplicate code to function');
        }
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error extracting duplicate: ${error.message || 'Unknown error'}`);
        console.error('Error extracting duplicate:', error);
    }
}

// Helper functions
function extractCodeChunks(document: TextDocument): { code: string; range: Range }[] {
    const chunks: { code: string; range: Range }[] = [];
    const lines = document.lineCount;
    
    // Process code in chunks of 5-10 lines for more meaningful duplication detection
    for (let i = 0; i < lines; i += 5) {
        // Use larger chunks to capture more meaningful duplicates
        const end = Math.min(i + 10, lines);
        if (end > i) { // Make sure we have at least one line
            try {
                const range = new Range(i, 0, end - 1, document.lineAt(end - 1).text.length);
                const code = document.getText(range).trim();
                
                // Only add non-empty chunks with meaningful content
                // Increased minimum length to avoid trivial duplicates
                if (code.length > 30 && !isCommentOnly(code) && hasCodeStructure(code)) {
                    chunks.push({ code, range });
                }
            } catch (e) {
                // Skip invalid ranges
                console.error('Error creating range:', e);
            }
        }
    }
    
    return chunks;
}

// Helper to check if a code chunk is only comments
function isCommentOnly(code: string): boolean {
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
function hasCodeStructure(code: string): boolean {
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

// Helper to normalize code for comparison
function normalizeCode(code: string): string {
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
function normalizeCodeContent(code: string): string {
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

// Enhanced similarity calculation that runs all algorithms and returns their average score
function calculateSimilarity(str1: string, str2: string, options: SimilarityOptions = {}): number {
    // Handle edge cases
    if (!str1 && !str2) return 1;
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;
    
    const {
        caseSensitive = false,
        ignoreWhitespace = true,
        minLength = 3,
        lengthPenalty = 0.3
    } = options;
    
    // Normalize strings based on options
    let normalized1 = caseSensitive ? str1 : str1.toLowerCase();
    let normalized2 = caseSensitive ? str2 : str2.toLowerCase();
    
    if (ignoreWhitespace) {
        normalized1 = normalized1.replace(/\s+/g, ' ').trim();
        normalized2 = normalized2.replace(/\s+/g, ' ').trim();
    }
    
    // Quick exit for very short strings
    if (normalized1.length < minLength && normalized2.length < minLength) {
        return normalized1 === normalized2 ? 1 : 0;
    }
    
    // Length difference check with configurable penalty
    const len1 = normalized1.length;
    const len2 = normalized2.length;
    const lengthDiff = Math.abs(len1 - len2);
    const minLen = Math.min(len1, len2);
    
    if (lengthDiff > minLen * lengthPenalty) {
        return 0;
    }
    
    // Run all similarity algorithms
    const similarities = [
        calculateLevenshteinSimilarity(normalized1, normalized2),
        calculateJaroSimilarity(normalized1, normalized2),
        calculateJaroWinklerSimilarity(normalized1, normalized2),
        calculateLCSSimilarity(normalized1, normalized2),
        calculateNGramSimilarity(normalized1, normalized2, 2)
    ];
    
    // Calculate the average similarity score
    const sum = similarities.reduce((acc, score) => acc + score, 0);
    const average = sum / similarities.length;
    
    return average;
}

// Optimized Levenshtein distance with early termination
function calculateLevenshteinSimilarity(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    
    // Use single array instead of 2D matrix for memory optimization
    let prev = Array(len2 + 1).fill(0).map((_, i) => i);
    let curr = Array(len2 + 1).fill(0);
    
    for (let i = 1; i <= len1; i++) {
        curr[0] = i;
        let minInRow = i;
        
        for (let j = 1; j <= len2; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            curr[j] = Math.min(
                prev[j] + 1,      // deletion
                curr[j - 1] + 1,  // insertion
                prev[j - 1] + cost // substitution
            );
            minInRow = Math.min(minInRow, curr[j]);
        }
        
        // Early termination if minimum distance in row is too high
        const maxAllowedDistance = Math.max(len1, len2) * 0.5;
        if (minInRow > maxAllowedDistance) {
            return 0;
        }
        
        // Swap arrays
        [prev, curr] = [curr, prev];
    }
    
    const maxLen = Math.max(len1, len2);
    return maxLen === 0 ? 1 : 1 - prev[len2] / maxLen;
}

// Jaro similarity algorithm
function calculateJaroSimilarity(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    
    if (len1 === 0 && len2 === 0) return 1;
    if (len1 === 0 || len2 === 0) return 0;
    
    const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
    if (matchWindow < 1) return str1 === str2 ? 1 : 0;
    
    const str1Matches = new Array(len1).fill(false);
    const str2Matches = new Array(len2).fill(false);
    
    let matches = 0;
    
    // Find matches
    for (let i = 0; i < len1; i++) {
        const start = Math.max(0, i - matchWindow);
        const end = Math.min(i + matchWindow + 1, len2);
        
        for (let j = start; j < end; j++) {
            if (str2Matches[j] || str1[i] !== str2[j]) continue;
            str1Matches[i] = true;
            str2Matches[j] = true;
            matches++;
            break;
        }
    }
    
    if (matches === 0) return 0;
    
    // Count transpositions
    let transpositions = 0;
    let k = 0;
    
    for (let i = 0; i < len1; i++) {
        if (!str1Matches[i]) continue;
        while (!str2Matches[k]) k++;
        if (str1[i] !== str2[k]) transpositions++;
        k++;
    }
    
    return (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
}

// Jaro-Winkler similarity (Jaro with prefix bonus)
function calculateJaroWinklerSimilarity(str1: string, str2: string, prefixScale: number = 0.1): number {
    const jaroSim = calculateJaroSimilarity(str1, str2);
    
    if (jaroSim < 0.7) return jaroSim;
    
    // Calculate common prefix length (up to 4 characters)
    let prefixLength = 0;
    const maxPrefix = Math.min(4, Math.min(str1.length, str2.length));
    
    for (let i = 0; i < maxPrefix; i++) {
        if (str1[i] === str2[i]) {
            prefixLength++;
        } else {
            break;
        }
    }
    
    return jaroSim + (prefixLength * prefixScale * (1 - jaroSim));
}

// Longest Common Subsequence similarity
function calculateLCSSimilarity(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    
    // Use space-optimized LCS
    let prev = new Array(len2 + 1).fill(0);
    let curr = new Array(len2 + 1).fill(0);
    
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                curr[j] = prev[j - 1] + 1;
            } else {
                curr[j] = Math.max(prev[j], curr[j - 1]);
            }
        }
        [prev, curr] = [curr, prev];
    }
    
    const lcsLength = prev[len2];
    const maxLen = Math.max(len1, len2);
    return maxLen === 0 ? 1 : lcsLength / maxLen;
}

// N-gram similarity
function calculateNGramSimilarity(str1: string, str2: string, n: number = 2): number {
    const ngrams1 = getNGrams(str1, n);
    const ngrams2 = getNGrams(str2, n);
    
    if (ngrams1.size === 0 && ngrams2.size === 0) return 1;
    if (ngrams1.size === 0 || ngrams2.size === 0) return 0;
    
    const intersection = new Set([...ngrams1].filter(x => ngrams2.has(x)));
    const union = new Set([...ngrams1, ...ngrams2]);
    
    return intersection.size / union.size;
}

function getNGrams(str: string, n: number): Set<string> {
    const ngrams = new Set<string>();
    const paddedStr = ' '.repeat(n - 1) + str + ' '.repeat(n - 1);
    
    for (let i = 0; i <= paddedStr.length - n; i++) {
        ngrams.add(paddedStr.substring(i, i + n));
    }
    
    return ngrams;
}

// Configuration interface for similarity options
interface SimilarityOptions {
    caseSensitive?: boolean;
    ignoreWhitespace?: boolean;
    minLength?: number;
    lengthPenalty?: number;
}

// Helper to check if two ranges overlap
function rangesOverlap(range1: Range, range2: Range): boolean {
    return (
        (range1.start.line <= range2.end.line && range1.end.line >= range2.start.line) ||
        (range2.start.line <= range1.end.line && range2.end.line >= range1.start.line)
    );
}

// Helper to generate a meaningful function name based on the content
function generateFunctionName(code: string): string {
    // Try to extract meaningful words from the code
    const words = code.match(/\b[A-Za-z][A-Za-z0-9]*\b/g) || [];
    
    // Filter out common keywords and short words
    const keywords = ['function', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'return', 'true', 'false'];
    const meaningfulWords = words.filter(word => 
        !keywords.includes(word.toLowerCase()) && word.length > 2
    );
    
    if (meaningfulWords.length > 0) {
        // Use the first 1-2 meaningful words
        const base = meaningfulWords.slice(0, 2).join('');
        return `extracted${base.charAt(0).toUpperCase() + base.slice(1)}`;
    }
    
    // Fallback to a generic name with random number
    return `extractedFunction${Math.floor(Math.random() * 1000)}`;
}


// Helper to extract potential parameters from the code
function extractPotentialParameters(code: string): { paramList: string, modifiedCode: string } {
    // Find variables that are used but not declared in the code block
    const declarations = new Set<string>();
    const usages = new Set<string>();
    
    // Extract variable declarations
    const declarationMatches = code.match(/\b(const|let|var)\s+([\w_]+)\b/g) || [];
    for (const match of declarationMatches) {
        const varName = match.split(/\s+/)[1];
        declarations.add(varName);
    }
    
    // Extract variable usages (simplified approach)
    const usageRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b(?!\s*[({:])/g;
    let match;
    while ((match = usageRegex.exec(code)) !== null) {
        const varName = match[1];
        // Skip keywords and common built-ins
        if (!['if', 'else', 'for', 'while', 'function', 'return', 'const', 'let', 'var',
             'true', 'false', 'null', 'undefined', 'this', 'console'].includes(varName)) {
            usages.add(varName);
        }
    }
    
    // Find variables used but not declared (potential parameters)
    const potentialParams = Array.from(usages).filter(usage => !declarations.has(usage));
    
    // Create parameter list
    const paramList = potentialParams.join(', ');
    
    return { paramList, modifiedCode: code };
}


