"use client";
import React, { useState, useEffect } from 'react';
import { Typography, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField, Snackbar, Alert, ToggleButtonGroup, ToggleButton, SelectChangeEvent, FormControl, InputLabel, Select, MenuItem } from "@mui/material";
import { useEditorContext } from "@/contexts/EditorContext";
import axios from 'axios';
import AceEditor from "react-ace";
import ace from "ace-builds";
import "ace-builds/src-noconflict/mode-tcl";
import "ace-builds/src-noconflict/mode-javascript";
import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/mode-text";
import "ace-builds/src-noconflict/mode-python";
import "ace-builds/src-noconflict/theme-tomorrow_night";
import "ace-builds/src-noconflict/ext-language_tools";
import "ace-builds/src-noconflict/ext-searchbox";

// Configure Ace paths (assuming files are copied to /public/ace/)
ace.config.set("basePath", "/ace/");
ace.config.set("modePath", "/ace/");
ace.config.set("themePath", "/ace/");
ace.config.set("workerPath", "/ace/");

// Helper to get Ace mode from file path
const getModeForPath = (filePath: string | null): string => {
  if (!filePath) return "text";
  const extension = filePath.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'tcl':
    case 'tm':
    case 'tcllib':
        return 'tcl';
    case 'js':
    case 'jsx': return 'javascript';
    case 'json': return 'json';
    case 'py': return 'python';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'css':
      return 'css';
    case 'html':
      return 'html';
    case 'md':
      return 'markdown';
    case 'yaml':
    case 'yml':
        return 'yaml';
    // Add more cases as needed
    default: return 'text';
  }
};

// Base URL for API calls
const API_BASE_URL = 'http://qpcs-server:3000';

export default function Home() {
  // Get state from context
  const {
    currentFilePath,
    currentFileContent,
    isLoading: isLoadingFile,
    error: fileLoadError,
    selectedBranch,
    loadFileContent,
    selectedUser,
    password,
    updateHasUnsavedChanges,
    updateCurrentFileContentDirectly,
    branches,
    backendStatus,
    checkBackendHealth,
  } = useEditorContext();

  // Dialog states
  const [isCancelModalOpen, setCancelModalOpen] = useState(false);
  const [isSaveModalOpen, setSaveModalOpen] = useState(false); // State for save modal
  const [isDiffModalOpen, setDiffModalOpen] = useState(false); // State for Diff modal
  const [isDiffResultModalOpen, setDiffResultModalOpen] = useState(false); // State for diff result modal

  // Editor state
  const [localCode, setLocalCode] = useState<string>("");
  
  // Save action state
  const [commitMessage, setCommitMessage] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSnackbar, setSaveSnackbar] = useState<{open: boolean, message: string, severity: "success" | "error" | "warning" | "info"} | null>(null);
  // Add state for version bump type
  const [versionBumpType, setVersionBumpType] = useState<string>('patch'); 

  // Diff action state
  const [diffTargetBranch, setDiffTargetBranch] = useState<string>(''); 
  const [isDiffing, setIsDiffing] = useState<boolean>(false); 
  const [diffResult, setDiffResult] = useState<string | null>(null); 

  // Calculate if there are unsaved changes
  const fileHasChanged = currentFileContent !== null && localCode !== currentFileContent;

  // --- Effect to update localCode when loaded content changes or branch changes ---
  useEffect(() => {
    setLocalCode(currentFileContent || "");
    // Also update context about unsaved changes when file content loads/branch changes
    updateHasUnsavedChanges(false); // Reset when new content loads or branch changes
    // Add selectedBranch to dependencies
  }, [currentFileContent, selectedBranch, updateHasUnsavedChanges]);

  // --- Effect to update context when local code changes --- 
  useEffect(() => {
    // Compare localCode with the originally loaded content
    const changed = currentFileContent !== null && localCode !== currentFileContent;
    updateHasUnsavedChanges(changed);
  }, [localCode, currentFileContent, updateHasUnsavedChanges]);

  // --- Handler for editor changes --- 
  const handleCodeChange = (newCode: string) => {
   setLocalCode(newCode); // Update local state as user types
  };

  // Button click handlers 
  const handleSave = () => {
    handleOpenSaveModal();
  };
  const handleDiff = () => {
    handleOpenDiffModal();
  };

  const editorMode = getModeForPath(currentFilePath);

  // --- Dialog Handlers ---
  const handleOpenCancelModal = () => {
    setCancelModalOpen(true);
  };

  const handleCloseCancelModal = () => {
    setCancelModalOpen(false);
  };

  const handleConfirmCancel = () => {
    setLocalCode(currentFileContent || "");
    handleCloseCancelModal();
    if (currentFilePath) { 
      loadFileContent(currentFilePath); 
    }
  };

  // --- Save Dialog Handlers ---
  const handleOpenSaveModal = () => {
    setCommitMessage(""); // Clear message on open
    setSaveModalOpen(true);
  };

  const handleCloseSaveModal = () => {
    setSaveModalOpen(false);
    // Optionally clear commit message state here too if desired
    // setCommitMessage("");
  };

  const handleCommitMessageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setCommitMessage(event.target.value);
  };

  // Handler for version bump toggle change
  const handleVersionBumpChange = (
    event: React.MouseEvent<HTMLElement>,
    newBumpType: string | null,
  ) => {
    // Ensure a selection is always made (default to patch if null)
    if (newBumpType !== null) {
      setVersionBumpType(newBumpType);
    } else {
        // If user somehow deselects all, default back to patch
        setVersionBumpType('patch'); 
    }
  };

  const handleConfirmSave = async () => {
    if (!selectedBranch || !currentFilePath || !selectedUser || !password) {
        setSaveSnackbar({open: true, message: "Branch, User, and Password are required to save.", severity: "error"});
        handleCloseSaveModal();
        return;
    }

    if (selectedBranch === 'main') {
       setSaveSnackbar({open: true, message: "Cannot commit directly to main branch.", severity: "error"});
       handleCloseSaveModal();
       return;
    }

    setIsSaving(true);
    handleCloseSaveModal();
    setSaveSnackbar(null);

    try {
      const base64Content = Buffer.from(localCode, 'utf-8').toString('base64');
      
      // Construct the final commit message with author info
      const baseCommitMessage = commitMessage || `Update ${currentFilePath}`;
      const finalCommitMessage = `${baseCommitMessage} [author: ${selectedUser}]`;
      
      console.log(`Attempting to save ${currentFilePath} to branch ${selectedBranch} as user ${selectedUser} with bump: ${versionBumpType}`);

      const response = await axios.post(`${API_BASE_URL}/commit-file`, {
        path: currentFilePath,
        message: finalCommitMessage, // Use the modified message
        content: base64Content,
        branch: selectedBranch,
        username: selectedUser, 
        password: password, 
        versionBumpType: versionBumpType, 
      });

      // Handle potential 207 Multi-Status for commit success but tag failure
      if ((response.status === 200 || response.status === 207) && response.data.success) {
         // Use correct severity type now
         setSaveSnackbar({open: true, message: response.data.message || "File saved successfully!", severity: response.status === 207 ? "warning" : "success"});
         // Update context state to reflect the saved content
         updateCurrentFileContentDirectly(localCode);
         updateHasUnsavedChanges(false);
         // Reset version bump selection to default
         setVersionBumpType('patch'); 
      } else {
         // Handle cases where API returns success: false or specific errors
         throw new Error(response.data.error || 'Save failed.');
      }

    } catch (err: unknown) {
        // Attempt to extract a meaningful error message
        let errorMessage = "An unknown error occurred during save.";
        if (axios.isAxiosError(err)) {
            errorMessage = err.response?.data?.error || err.response?.data?.message || err.message;
        } else if (err instanceof Error) {
            errorMessage = err.message;
        }
        setSaveSnackbar({open: true, message: `Save failed: ${errorMessage}`, severity: "error"});
        checkBackendHealth();
    } finally {
        setIsSaving(false);
    }
  };
  // --- End Save Dialog Handlers ---
  
  // --- Diff Modal Handlers ---
  const handleOpenDiffModal = () => {
    // Find the first branch that isn't the currently selected one
    const initialTargetBranch = branches.find(b => b.name !== selectedBranch)?.name || '';
    setDiffTargetBranch(initialTargetBranch); // Reset/Set initial target branch on open
    setDiffModalOpen(true);
  };

  const handleCloseDiffModal = () => {
    setDiffModalOpen(false);
  };
  
  const handleDiffTargetBranchChange = (event: SelectChangeEvent<string>) => {
    setDiffTargetBranch(event.target.value as string);
  };

  const handleConfirmDiff = async () => {
    performDiff(diffTargetBranch);
    handleCloseDiffModal();
  };

  // Shared function to perform the diff API call
  const performDiff = async (compareToBranch: string | null) => {
    if (!compareToBranch || !currentFilePath || !selectedBranch) {
      console.error("Missing information for diff");
      setSaveSnackbar({ open: true, message: 'Missing required information for diff comparison.', severity: 'error' });
      return;
    }

    // Determine display text based on comparison target
    const diffTypeDisplay = (selectedBranch === compareToBranch) ? 'committed state' : `branch ${compareToBranch}`;
    console.log(`Initiating diff for ${currentFilePath} between local changes and ${diffTypeDisplay}`);
    setIsDiffing(true);
    setDiffResult(null);

    try {
      const response = await axios.post(`${API_BASE_URL}/get-diff`, {
        filePath: currentFilePath,
        baseBranch: selectedBranch,
        targetBranch: compareToBranch,
        username: selectedUser,
        password: password,
      });

      if (response.status === 200 && response.data.diff) {
        setDiffResult(response.data.diff);
        setDiffResultModalOpen(true); // Open the result modal
      } else {
        throw new Error(response.data.error || 'Failed to get diff.');
      }

    } catch (err: unknown) {
        // Attempt to extract a meaningful error message
        let errorMessage = "An unknown error occurred while fetching diff.";
        if (axios.isAxiosError(err)) {
            errorMessage = err.response?.data?.error || err.response?.data?.message || err.message;
        } else if (err instanceof Error) {
            errorMessage = err.message;
        }
        setSaveSnackbar({ open: true, message: `Diff failed: ${errorMessage}`, severity: "error" });
        checkBackendHealth();
    } finally {
      setIsDiffing(false);
    }
  };

  // --- Diff Result Modal Handlers ---
  const handleCloseDiffResultModal = () => {
    setDiffResultModalOpen(false);
    setDiffResult(null); 
    setDiffTargetBranch(''); 
  };
  // --- End Diff Modal Handlers ---
  
  // --- Snackbar close handler ---
  const handleCloseSnackbar = (event?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') {
      return;
    }
    setSaveSnackbar(null);
  };

  // Render Logic
  const renderContent = () => {
    if (currentFilePath) {
      return (
        <Box 
          sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}
        >
          {/* Backend Status Alert - NEW */}
          {backendStatus === 'offline' && (
            <Alert 
              severity="error" 
              variant="filled" // Use filled variant for high visibility
              sx={{ 
                position: 'sticky', // Make it stick to the top
                top: 0, 
                zIndex: 1500, // Ensure it's above other elements
                borderRadius: 0, // Remove border radius for full width appearance
                mb: 1 // Add some margin below
              }}
            >
              Backend server is unavailable. Please ensure it is running.
            </Alert>
          )}

          {/* File Path Label - Adjust Padding */}
          <Typography 
            variant="caption" 
            sx={{ 
              pl: 1, 
              pr: 1,
              pt: 0,    // Decrease top padding
              pb: 1,    // Increase bottom padding
              fontStyle: 'italic', 
              height: '24px' /* Fixed height */ 
            }}
          >
            {currentFilePath || "No file selected"}
          </Typography>

          {/* Ace Editor Area - Parent needs position: relative (already has it) */}
          <Box sx={{ position: 'relative', flexGrow: 1, overflow: 'hidden' }}>
            {/* Editor itself */}
            <AceEditor
              mode={editorMode}
              theme="tomorrow_night"
              onChange={handleCodeChange}
              value={localCode}
              readOnly={isLoadingFile || currentFilePath === null}
              name="ACE_EDITOR"
              editorProps={{ $blockScrolling: true }}
              setOptions={{
                enableBasicAutocompletion: true,
                enableLiveAutocompletion: true,
                enableSnippets: true,
                showLineNumbers: true,
                tabSize: 2,
              }}
              width="100%"
              height="calc(100vh - 64px - 48px)" // Adjust height based on Header and potential footer/status bar
            />
            {/* Loading Overlay */}
            {isLoadingFile && (
              <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2 }}>
                <CircularProgress />
              </Box>
            )}
             {/* Error Display (could be an overlay or separate Box) */}
             {fileLoadError && (
                 <Box sx={{ p: 1, background: 'error.main', color: 'error.contrastText' }}>
                     <Typography variant="body2">Error: {fileLoadError}</Typography>
                 </Box>
             )}

            {/* Action Buttons (Moved Back & Positioned Absolutely) */}
            <Box sx={{
              position: 'absolute',
              bottom: theme => theme.spacing(2), // Position from bottom
              right: theme => theme.spacing(2), // Position from right
              zIndex: 10, // Ensure it's above editor content
              display: 'flex', 
              gap: 1,
              // Optional: Add slight background for contrast
              // backgroundColor: theme => alpha(theme.palette.background.paper, 0.7),
              // padding: theme => theme.spacing(1),
              // borderRadius: theme => theme.shape.borderRadius,
            }}>
              <Button 
                variant="outlined" 
                color="secondary" 
                onClick={handleOpenCancelModal}
                disabled={isLoadingFile || !currentFilePath || !fileHasChanged}
              >
                Cancel
              </Button>
              {/* Diff Button Moved Here */}
               <Button 
                variant="outlined" 
                color="info"
                onClick={handleDiff}
                disabled={isLoadingFile || !currentFilePath || !selectedBranch}
              >
                Diff
              </Button>
              <Button 
                variant="contained" 
                color="primary" 
                onClick={handleSave} 
                disabled={isLoadingFile || !currentFilePath || isSaving || !fileHasChanged}
              >
                {isSaving ? <CircularProgress size={24} color="inherit" /> : "Save"}
              </Button>
            </Box>
          </Box>

          {/* Confirmation Dialog */}
          <Dialog
            open={isCancelModalOpen}
            onClose={handleCloseCancelModal}
            aria-labelledby="alert-dialog-title"
            aria-describedby="alert-dialog-description"
          >
            <DialogTitle id="alert-dialog-title">
              {"Discard Changes?"}
            </DialogTitle>
            <DialogContent>
              <DialogContentText id="alert-dialog-description">
                Are you sure you&apos;d like to discard your changes? The current editor content will be reloaded from the repository.
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={handleCloseCancelModal}>No</Button>
              <Button onClick={handleConfirmCancel} autoFocus> 
                Yes
              </Button>
            </DialogActions>
          </Dialog>

          {/* Save Confirmation Dialog - Add ToggleButtonGroup */}
          <Dialog 
            open={isSaveModalOpen} 
            onClose={handleCloseSaveModal}
            sx={{ '& .MuiDialog-paper': { minWidth: '600px' } }} 
          >
            <DialogTitle>Save File & Create Version Tag</DialogTitle>
            <DialogContent>
              <DialogContentText sx={{ mb: 1 }}> 
                Committing to: <strong>{selectedBranch || 'N/A'}</strong>
              </DialogContentText>
              
              <TextField
                autoFocus
                margin="dense"
                id="commit-message"
                label="Commit Message (optional)"
                placeholder="Enter commit message..."
                fullWidth
                variant="outlined"
                value={commitMessage}
                onChange={handleCommitMessageChange}
                multiline
                rows={4}
              />
              
              {/* Version Bump Selection - Conditional Rendering */}
              {selectedUser === 'admin' && (
                <Box sx={{ mt: 2, mb: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <Typography variant="overline" gutterBottom>
                    Version Bump Type
                  </Typography>
                  <ToggleButtonGroup
                    value={versionBumpType}
                    exclusive
                    onChange={handleVersionBumpChange}
                    aria-label="version bump type"
                    size="small"
                  >
                    <ToggleButton value="patch" aria-label="patch version">
                      Patch
                    </ToggleButton>
                    <ToggleButton value="minor" aria-label="minor version">
                      Minor
                    </ToggleButton>
                    <ToggleButton value="major" aria-label="major version">
                      Major
                    </ToggleButton>
                  </ToggleButtonGroup>
                </Box>
              )}

            </DialogContent>
            <DialogActions>
              <Button onClick={handleCloseSaveModal}>Cancel</Button>
              <Button onClick={handleConfirmSave} disabled={!selectedBranch || selectedBranch === 'main' || isSaving}>Submit</Button> 
            </DialogActions>
          </Dialog>

          {/* Diff Modal */}
          <Dialog
            open={isDiffModalOpen}
            onClose={handleCloseDiffModal}
            aria-labelledby="diff-dialog-title"
            maxWidth="xs" 
            fullWidth
          >
            <DialogTitle id="diff-dialog-title">Compare with Branch</DialogTitle>
            <DialogContent>
              <DialogContentText sx={{ mb: 2 }}>
                Select a branch to compare the current changes in{' '}
                <strong>{currentFilePath ? currentFilePath.split('/').pop() : 'this file'}</strong>{' '}
                against.
              </DialogContentText>
              <FormControl fullWidth required margin="dense">
                <InputLabel id="diff-branch-select-label">Branch to Compare</InputLabel>
                <Select
                  labelId="diff-branch-select-label"
                  id="diff-branch-select"
                  value={diffTargetBranch}
                  label="Branch to Compare"
                  onChange={handleDiffTargetBranchChange}
                  disabled={isDiffing}
                >
                  {branches
                    .map((branch) => (
                      <MenuItem key={branch.name} value={branch.name}>
                        {branch.name}
                      </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </DialogContent>
            <DialogActions>
              <Button onClick={handleCloseDiffModal} disabled={isDiffing}>Cancel</Button>
              <Button 
                onClick={() => performDiff(diffTargetBranch)}
                variant="contained" 
                disabled={!diffTargetBranch || isDiffing} 
              >
                {isDiffing ? <CircularProgress size={24} /> : "Compare"}
              </Button>
            </DialogActions>
          </Dialog>

          {/* Diff Result Modal */}
          <Dialog open={isDiffResultModalOpen} onClose={handleCloseDiffResultModal} fullWidth maxWidth="lg">
            <DialogTitle>Diff Result for {currentFilePath}</DialogTitle>
            <DialogContent>
              {isDiffing ? (
                  <CircularProgress />
              ) : diffResult ? (
                  <AceEditor
                      mode="diff" // Use diff mode
                      theme="github" // A light theme might be better for diffs
                      value={diffResult}
                      readOnly={true}
                      name="DIFF_VIEWER"
                      editorProps={{ $blockScrolling: true }}
                      width="100%"
                      height="60vh"
                      setOptions={{
                          showLineNumbers: true,
                          useWorker: false // Diff mode often doesn't need a worker
                      }}
                  />
              ) : (
                  <DialogContentText>No differences found or unable to compute diff.</DialogContentText>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={handleCloseDiffResultModal}>Close</Button>
            </DialogActions>
          </Dialog>

          {/* Save Feedback Snackbar */}
          {saveSnackbar && (
              <Snackbar
                  open={saveSnackbar.open}
                  autoHideDuration={6000}
                  onClose={handleCloseSnackbar}
                  anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
              >
                  <Alert onClose={handleCloseSnackbar} severity={saveSnackbar.severity} sx={{ width: '100%' }}>
                      {saveSnackbar.message}
                  </Alert>
              </Snackbar>
          )}

        </Box>
      );
    }
    return <Typography sx={{ p: 2, color: 'text.secondary' }}>Please select a file or create a new one.</Typography>;
  };

  return (
    <Box sx={{ display: 'flex' /* Adjust layout as needed, e.g., add Header/Drawer back if required */ }}>
      {/* Main Content Area */}
      <Box component="main" sx={{ flexGrow: 1, p: 3, marginTop: '64px' /* Adjust if Header is present */ }}>
          {renderContent()}
      </Box>

      {/* Modals and Snackbar rendered at the top level, outside the main content flow */}

      {/* Cancel Confirmation Dialog */}
      <Dialog
        open={isCancelModalOpen}
        onClose={handleCloseCancelModal}
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
      >
        <DialogTitle id="alert-dialog-title">
          {"Discard Changes?"}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="alert-dialog-description">
             Are you sure you&apos;d like to discard your changes? The current editor content will be reloaded from the repository.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseCancelModal}>No</Button>
          <Button onClick={handleConfirmCancel} autoFocus>
            Yes
          </Button>
        </DialogActions>
      </Dialog>

      {/* Save Confirmation Dialog */}
      <Dialog
        open={isSaveModalOpen}
        onClose={handleCloseSaveModal}
        sx={{ '& .MuiDialog-paper': { minWidth: '600px' } }}
      >
          <DialogTitle>Save File & Create Version Tag</DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ mb: 1 }}>
              Committing to: <strong>{selectedBranch || 'N/A'}</strong>
            </DialogContentText>

            <TextField
              autoFocus
              margin="dense"
              id="commit-message"
              label="Commit Message (optional)"
              placeholder="Enter commit message..."
              fullWidth
              variant="outlined"
              value={commitMessage}
              onChange={handleCommitMessageChange}
              multiline
              rows={4}
            />

            {/* Version Bump Selection - Conditional Rendering */}
            {selectedUser === 'admin' && (
              <Box sx={{ mt: 2, mb: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <Typography variant="overline" gutterBottom>
                  Version Bump Type
                </Typography>
                <ToggleButtonGroup
                  value={versionBumpType}
                  exclusive
                  onChange={handleVersionBumpChange}
                  aria-label="version bump type"
                  size="small"
                >
                  <ToggleButton value="patch" aria-label="patch version">
                    Patch
                  </ToggleButton>
                  <ToggleButton value="minor" aria-label="minor version">
                    Minor
                  </ToggleButton>
                  <ToggleButton value="major" aria-label="major version">
                    Major
                  </ToggleButton>
                </ToggleButtonGroup>
              </Box>
            )}

          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseSaveModal}>Cancel</Button>
            <Button onClick={handleConfirmSave} disabled={!selectedBranch || selectedBranch === 'main' || isSaving}>Submit</Button>
          </DialogActions>
      </Dialog>

      {/* Diff Modal */}
      <Dialog
        open={isDiffModalOpen}
        onClose={handleCloseDiffModal}
        aria-labelledby="diff-dialog-title"
        maxWidth="xs"
        fullWidth
      >
          <DialogTitle id="diff-dialog-title">Compare with Branch</DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>
              Select a branch to compare the current changes in{' '}
              <strong>{currentFilePath ? currentFilePath.split('/').pop() : 'this file'}</strong>{' '}
              against.
            </DialogContentText>
            <FormControl fullWidth required margin="dense">
              <InputLabel id="diff-branch-select-label">Branch to Compare</InputLabel>
              <Select
                labelId="diff-branch-select-label"
                id="diff-branch-select"
                value={diffTargetBranch}
                label="Branch to Compare"
                onChange={handleDiffTargetBranchChange}
                disabled={isDiffing}
              >
                {branches
                  .map((branch) => (
                    <MenuItem key={branch.name} value={branch.name}>
                      {branch.name}
                    </MenuItem>
                ))}
              </Select>
            </FormControl>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseDiffModal} disabled={isDiffing}>Cancel</Button>
            <Button
              onClick={() => performDiff(diffTargetBranch)}
              variant="contained"
              disabled={!diffTargetBranch || isDiffing}
            >
              {isDiffing ? <CircularProgress size={24} /> : "Compare"}
            </Button>
          </DialogActions>
      </Dialog>

      {/* Diff Result Modal */}
      <Dialog open={isDiffResultModalOpen} onClose={handleCloseDiffResultModal} fullWidth maxWidth="lg">
        <DialogTitle>Diff Result for {currentFilePath}</DialogTitle>
        <DialogContent>
          {isDiffing ? (
              <CircularProgress />
          ) : diffResult ? (
              <AceEditor
                  mode="diff" // Use diff mode
                  theme="github" // A light theme might be better for diffs
                  value={diffResult}
                  readOnly={true}
                  name="DIFF_VIEWER"
                  editorProps={{ $blockScrolling: true }}
                  width="100%"
                  height="60vh"
                  setOptions={{
                      showLineNumbers: true,
                      useWorker: false // Diff mode often doesn't need a worker
                  }}
              />
          ) : (
              <DialogContentText>No differences found or unable to compute diff.</DialogContentText>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDiffResultModal}>Close</Button>
        </DialogActions>
      </Dialog>


      {/* Save Feedback Snackbar */}
      {saveSnackbar && (
          <Snackbar
              open={saveSnackbar.open}
              autoHideDuration={6000}
              onClose={handleCloseSnackbar}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          >
              <Alert onClose={handleCloseSnackbar} severity={saveSnackbar.severity} sx={{ width: '100%' }}>
                  {saveSnackbar.message}
              </Alert>
          </Snackbar>
      )}
    </Box>
  );
}
