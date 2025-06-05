import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

const execAsync = promisify(exec);

export async function POST(request: Request) {
  let tempFilePath = '';

  try {
    const body = await request.json();
    const { code, language, options = {} } = body;

    if (typeof code !== 'string' || typeof language !== 'string') {
      return NextResponse.json({ error: 'Invalid request: "code" and "language" must be strings.' }, { status: 400 });
    }

    if (language !== 'tcl') {
      return NextResponse.json({ error: `Formatting not supported for language: ${language}` }, { status: 400 });
    }
    
    // --- TCL Formatting Logic ---
    const homeDir = process.env.HOME;
    if (!homeDir) {
      console.error('[API format-code] HOME environment variable not set.');
      return NextResponse.json({ error: 'Server configuration error: HOME not set.' }, { status: 500 });
    }

    const tempFileName = `format-${uuidv4()}.tcl`;
    tempFilePath = path.join(os.tmpdir(), tempFileName);
    await fs.writeFile(tempFilePath, code, 'utf-8');
    
    const pythonInterpreter = path.resolve(homeDir, 'git_ix/tclint-env/bin/python');
    const tclfmtScript = path.resolve(homeDir, 'git_ix/tclint-env/bin/tclfmt');

    // Construct command with options
    const indentSize = options.indent || 4; // Default indent
    let command = `${pythonInterpreter} ${tclfmtScript} --indent ${indentSize} ${tempFilePath}`;

    console.log(`[API format-code] Executing: ${command}`);

    // tclfmt outputs formatted code to stdout. If it fails (e.g. syntax error),
    // it writes to stderr and exits with a non-zero code, making execAsync throw.
    const { stdout, stderr } = await execAsync(command);
    
    if (stderr) {
        // Log warnings but don't fail if there's also formatted output
        console.warn(`[API format-code] tclfmt produced warnings: ${stderr}`);
    }

    return NextResponse.json({ formattedCode: stdout });

  } catch (error: any) {
    // This block catches errors from execAsync (e.g., tclfmt syntax errors) or other unexpected issues.
    console.error('[API format-code] Error during formatting:', error);
    
    // Provide specific error feedback if tclfmt fails due to syntax issues
    if (error.stderr) {
      return NextResponse.json(
        { 
          error: 'Failed to format code. Check for syntax errors.', 
          details: error.stderr 
        }, 
        { status: 400 } // Bad Request, since the input code was likely invalid
      );
    }

    return NextResponse.json(
      { error: 'An unexpected server error occurred during formatting.', details: error.message }, 
      { status: 500 }
    );
  } finally {
    // Cleanup: ensure the temporary file is deleted
    if (tempFilePath) {
      await fs.unlink(tempFilePath).catch(e => console.warn(`[API format-code] Failed to delete temp file: ${tempFilePath}`, e));
    }
  }
} 