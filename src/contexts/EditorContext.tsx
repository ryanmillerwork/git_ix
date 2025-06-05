"use client"; // This context will be used in client components

import React, { createContext, useState, useContext, ReactNode, useCallback, useEffect, useRef } from 'react';
import axios from 'axios'; // Import axios

// Base URL for API calls
// Commented out as API calls should use relative paths for Next.js API routes
// const API_BASE_URL = 'http://qpcs-server:3000';

// Re-use Branch interface (or define centrally)
interface Branch {
  name: string;
  commit: { sha: string; url: string; };
  protected: boolean;
}

// Type for the diff with main
interface DiffEntry {
    filename: string;
    status: 'added' | 'removed' | 'modified' | 'renamed';
    additions: number;
    deletions: number;
    changes: number;
}

// Type for backend status
type BackendStatus = 'checking' | 'online' | 'offline';

// Define TreeNode structure (needed by Drawer)
interface TreeNode {
    id: string;
    name: string;
    type: 'blob' | 'tree';
    path: string;
    children?: TreeNode[];
    sha?: string; // Optional: SHA for files/folders
}

// Define the shape of the context data
interface EditorContextType {
    currentFilePath: string | null;
    currentFileContent: string | null;
    selectedFile: string | null;
    updateSelectedFile: (filePath: string | null) => void;
    isLoading: boolean;
    error: string | null;
    loadFileContent: (filePath: string | null, branchOverride?: string | null) => Promise<void>;
    selectedBranch: string | null;
    updateSelectedBranch: (branch: string | null) => void;
    selectedUser: string | null;
    password: string;
    updateSelectedUser: (user: string | null) => void;
    updatePassword: (password: string) => void;
    branches: Branch[];
    updateBranches: (branches: Branch[]) => void;
    hasUnsavedChanges: boolean;
    updateHasUnsavedChanges: (value: boolean) => void;
    updateCurrentFileContentDirectly: (content: string) => void;
    branchStateCounter: number;
    incrementBranchStateCounter: () => void;
    backendStatus: BackendStatus;
    checkBackendHealth: () => Promise<void>;
    addRetryAction: (id: string, action: () => Promise<void>) => void;
    diffWithMain: DiffEntry[] | null;

    // Added for Drawer
    folderStructure: TreeNode[];
    isLoadingFolderStructure: boolean;
    fetchFolderStructure: (branch: string) => Promise<void>;
    credentials: { githubToken?: string } | null;
    updateCredentials: (token: string | null) => void;

    // Functions for file operations
    renameItem: (path: string, newName: string) => Promise<void>;
    deleteItem: (path: string, message: string) => Promise<void>;
    addFile: (path: string, fileName: string) => Promise<void>;
    addFolder: (path: string, folderName: string) => Promise<void>;
}

const EditorContext = createContext<EditorContextType | undefined>(undefined);

export const EditorProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
    const [currentFileContent, setCurrentFileContent] = useState<string | null>(null);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
    const [selectedUser, setSelectedUser] = useState<string | null>(null);
    const [password, setPassword] = useState<string>("");
    const [branches, setBranches] = useState<Branch[]>([]);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
    const [branchStateCounter, setBranchStateCounter] = useState<number>(0);
    const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking');
    const [pendingRetryActions, setPendingRetryActions] = useState<({ id: string, action: () => Promise<void> })[]>([]);
    const [diffWithMain, setDiffWithMain] = useState<DiffEntry[] | null>(null);

    // Added state for Drawer
    const [folderStructure, setFolderStructure] = useState<TreeNode[]>([]);
    const [isLoadingFolderStructure, setIsLoadingFolderStructure] = useState<boolean>(false);
    const [credentials, setCredentials] = useState<{ githubToken?: string } | null>(null);

    const compareBranchWithMain = useCallback(async (branch: string) => {
        if (!branch || branch === 'main') {
            setDiffWithMain([]);
            return;
        }
        console.log(`[EditorContext] Comparing branch ${branch} with main`);
        try {
            const response = await axios.get(`/api/github/compare-with-main?branch=${encodeURIComponent(branch)}`);
            if (response.data.diff_with_main) {
                setDiffWithMain(response.data.diff_with_main);
            }
        } catch (err) {
            console.error('[EditorContext] Failed to compare branch with main:', err);
            setDiffWithMain(null); // Set to null on error
        }
    }, []);

    const updateSelectedBranch = useCallback((branch: string | null) => {
        // Only update if the branch has actually changed
        if (branch !== selectedBranch) {
            console.log(`[EditorContext] Branch selection changed from '${selectedBranch}' to '${branch}'`);
            setSelectedBranch(branch);
            // Reset file-specific states
            setCurrentFilePath(null);
            setCurrentFileContent(null);
            setSelectedFile(null);
            setHasUnsavedChanges(false); // Reset unsaved changes flag
            setError(null); // Clear any previous errors

            // Increment counter to trigger re-fetch of branch-specific data in components
            setBranchStateCounter(prev => prev + 1);

            // Fetch comparison with main for the new branch
            if (branch) {
                compareBranchWithMain(branch);
            } else {
                setDiffWithMain([]); // Clear diff if no branch is selected
            }
        }
    }, [selectedBranch, compareBranchWithMain]);
    
    // Placeholder implementations for new file operation functions
    const renameItem = async (path: string, newName: string) => {
        console.warn('[CONTEXT STUB] renameItem called but not implemented:', { path, newName });
        // In a real implementation, you would make an API call here.
        // e.g., await axios.post('/api/github/rename-item', { ... });
        // For now, we'll just resolve the promise to satisfy the type.
        return Promise.resolve();
    };

    const deleteItem = async (path: string, message: string) => {
        console.warn('[CONTEXT STUB] deleteItem called but not implemented:', { path, message });
        return Promise.resolve();
    };

    const addFile = async (path: string, fileName: string) => {
        console.warn('[CONTEXT STUB] addFile called but not implemented:', { path, fileName });
        return Promise.resolve();
    };

    const addFolder = async (path: string, folderName: string) => {
        console.warn('[CONTEXT STUB] addFolder called but not implemented:', { path, folderName });
        return Promise.resolve();
    };

    // Ref to track initial mount
    const isInitialMount = useRef(true);

    // Ref to track the current backend status to avoid stale closures in checkBackendHealth check
    const backendStatusRef = useRef(backendStatus);
    useEffect(() => {
        backendStatusRef.current = backendStatus;
    }, [backendStatus]);

    // Modified: Accept ID and de-duplicate
    const addRetryAction = useCallback((id: string, action: () => Promise<void>) => {
        setPendingRetryActions(prevActions => {
            // Check if an action with the same ID already exists
            if (prevActions.some(item => item.id === id)) {
                console.log(`[EditorContext] Action with ID '${id}' already in retry queue. Skipping.`);
                return prevActions; // Don't add if duplicate
            }
            console.log(`[EditorContext] Adding action with ID '${id}' to retry queue.`);
            return [...prevActions, { id, action }]; // Add the new action with its ID
        });
    }, []);

    // --- Health Check Function --- 
    const checkBackendHealth = useCallback(async (isRetryAttempt = false) => { // Add flag to differentiate checks
        // Only log "Checking..." if it's not a background retry triggered by the interval
        if (!isRetryAttempt) {
            console.log('[EditorContext] Checking backend health...');
        }
        try {
            // Use relative path for consistency
            const response = await axios.get(`/api/health`, { timeout: 5000 }); // Removed cache buster
            if (response.status === 200 && response.data?.status === 'ok') {
                // Check if status is changing from offline to online
                const wasOffline = backendStatusRef.current === 'offline'; 
                
                // Always update status - use a ref to track previous state for transition detection
                setBackendStatus('online'); 
                backendStatusRef.current = 'online'; // Update ref

                if (wasOffline) {
                    console.log('[EditorContext] Backend came online. Triggering retry actions...');
                    // Trigger retry actions IMMEDIATELY after setting state to online
                    // Use a separate effect or trigger mechanism if state update timing is an issue
                    // For simplicity here, assume state update is fast enough or handle in the effect below.
                } else if (!isRetryAttempt) {
                     console.log('[EditorContext] Backend is online.');
                }

            } else {
                // Don't throw error here if already offline, just ensure state is offline
                if (backendStatusRef.current !== 'offline') {
                     console.error(`[EditorContext] Unexpected health check status: ${response.status}`);
                     setBackendStatus('offline');
                     backendStatusRef.current = 'offline';
                }
            }
        } catch (error: any) {
             // Only log error if not already offline or if it's the first check
            if (backendStatusRef.current !== 'offline' || !isRetryAttempt) {
                console.error('[EditorContext] Backend health check failed:', error.message);
            }
             if (backendStatusRef.current !== 'offline') {
                setBackendStatus('offline');
                backendStatusRef.current = 'offline';
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Dependencies managed carefully below

    // --- Function to Fetch Folder Structure ---
    const fetchFolderStructure = useCallback(async (branch: string) => {
        if (!branch) {
            setFolderStructure([]);
            setError("Cannot fetch folder structure: No branch selected.");
            return;
        }
        console.log(`[EditorContext] Fetching folder structure for branch: ${branch}`);
        setIsLoadingFolderStructure(true);
        setError(null);
        try {
            // Use relative URL for API route
            const response = await fetch(`/api/github/folder-structure?branch=${encodeURIComponent(branch)}`);

            if (!response.ok) {
                let errorMsg = `HTTP error! status: ${response.status}`;
                try {
                    const errorData = await response.json();
                    if (errorData.error) {
                        errorMsg += `: ${errorData.error}`;
                    }
                } catch (parseError) { /* Ignore */ }
                throw new Error(errorMsg);
            }

            const data = await response.json();
            if (data.error) {
                throw new Error(data.error);
            }

            setFolderStructure(data.tree || []); // Assuming API returns { tree: [...] }

        } catch (err: any) {
            const errorMsg = err.message || "Failed to load folder structure";
            console.error(`[EditorContext] ${errorMsg}`);
            setError(errorMsg);
            setFolderStructure([]); // Clear structure on error

            // Optional: Add retry logic if needed, similar to loadFileContent
            const isNetworkError = err.message.includes('Network Error') || err.message.includes('timeout') || err.message.includes('Failed to fetch');
             if (backendStatusRef.current === 'offline' || isNetworkError) {
                 const retryId = `load-structure-${branch}`;
                 console.log(`[EditorContext] Backend offline or network error loading folder structure. Queuing action ${retryId} for retry.`);
                 addRetryAction(retryId, () => fetchFolderStructure(branch));
             }
             checkBackendHealth(); // Check health if fetch fails

        } finally {
            setIsLoadingFolderStructure(false);
        }
    }, [addRetryAction, checkBackendHealth]); // Dependencies

    const loadFileContent = useCallback(async (filePath: string | null, branchOverride?: string | null) => {
        if (!filePath) {
            setCurrentFilePath(null);
            setCurrentFileContent(null);
            setError(null);
            return;
        }
        
        // Use override if provided, otherwise use context state
        const branchToLoad = branchOverride !== undefined ? branchOverride : selectedBranch;

        if (!branchToLoad) {
            setError("Cannot load file content: No branch selected or provided.");
            setCurrentFilePath(filePath);
            setCurrentFileContent(null); // Clear content if branch is missing
            return;
        }

        console.log(`[EditorContext] Loading file: ${filePath} on branch: ${branchToLoad}`);
        setIsLoading(true);
        setError(null);
        try {
            // Use relative URL for API route
            const response = await fetch(`/api/github/file-contents?path=${encodeURIComponent(filePath)}&branch=${encodeURIComponent(branchToLoad)}`);

            if (!response.ok) {
                 let errorMsg = `HTTP error! status: ${response.status}`;
                 try {
                     const errorData = await response.json();
                     if (errorData.error) {
                         errorMsg += `: ${errorData.error}`;
                     }
                 } catch (parseError) { /* Ignore */ }
                throw new Error(errorMsg);
            }

            const data = await response.json();
            if (data.error) {
                throw new Error(data.error);
            }
            setCurrentFilePath(filePath);
            setCurrentFileContent(data.content);
            setHasUnsavedChanges(false); // Reset unsaved changes on new file load

        } catch (err: any) {
            const errorMsg = err.message || "Failed to load file content.";
            console.error(`[EditorContext] ${errorMsg}`);
            setError(errorMsg);
            setCurrentFilePath(filePath); // Keep path even if content fails to load
            setCurrentFileContent(null); // Clear content on error

             const isNetworkError = err.message.includes('Network Error') || err.message.includes('timeout') || err.message.includes('Failed to fetch');
             if (backendStatusRef.current === 'offline' || isNetworkError) {
                 const retryId = `load-file-${filePath}-${branchToLoad}`;
                 console.log(`[EditorContext] Backend offline or network error. Queuing action ${retryId} for retry.`);
                 addRetryAction(retryId, () => loadFileContent(filePath, branchToLoad));
             }
             checkBackendHealth(); // Check health if fetch fails

        } finally {
            setIsLoading(false);
        }
    }, [selectedBranch, addRetryAction, checkBackendHealth]);

    // Effect for initial health check and setting up interval
    useEffect(() => {
        checkBackendHealth(); // Initial check
        const intervalId = setInterval(() => checkBackendHealth(true), 30000); // Check every 30s
        return () => clearInterval(intervalId); // Cleanup
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Run only on mount

    // Effect to run pending actions when backend comes online
    useEffect(() => {
        const runPendingActions = async () => {
            if (backendStatus === 'online' && pendingRetryActions.length > 0) {
                console.log(`[EditorContext] Backend is online, executing ${pendingRetryActions.length} queued actions.`);
                const actionsToRun = [...pendingRetryActions]; // Copy actions
                setPendingRetryActions([]); // Clear queue immediately

                for (const item of actionsToRun) {
                    try {
                        console.log(`[EditorContext] Retrying action: ${item.id}`);
                        await item.action();
                    } catch (error) {
                        console.error(`[EditorContext] Retry action ${item.id} failed:`, error);
                        // Optional: Add failed actions back to the queue or handle differently
                    }
                }
            }
        };
        runPendingActions();
    }, [backendStatus, pendingRetryActions]);

    const contextValue: EditorContextType = {
        currentFilePath,
        currentFileContent,
        selectedFile,
        updateSelectedFile: setSelectedFile,
        isLoading,
        error,
        loadFileContent,
        selectedBranch,
        updateSelectedBranch,
        selectedUser,
        password,
        updateSelectedUser: setSelectedUser,
        updatePassword: setPassword,
        branches,
        updateBranches: setBranches,
        hasUnsavedChanges,
        updateHasUnsavedChanges: setHasUnsavedChanges,
        updateCurrentFileContentDirectly: setCurrentFileContent,
        branchStateCounter,
        incrementBranchStateCounter: () => setBranchStateCounter(prev => prev + 1),
        backendStatus,
        checkBackendHealth,
        addRetryAction,
        diffWithMain,

        // Drawer related
        folderStructure,
        isLoadingFolderStructure,
        fetchFolderStructure,
        credentials,
        updateCredentials: (token: string | null) => {
            setCredentials(token ? { githubToken: token } : null);
        },

        // File operations
        renameItem,
        deleteItem,
        addFile,
        addFolder,
    };

    return (
        <EditorContext.Provider value={contextValue}>
            {children}
        </EditorContext.Provider>
    );
};

export const useEditorContext = (): EditorContextType => {
    const context = useContext(EditorContext);
    if (!context) {
        throw new Error('useEditorContext must be used within an EditorProvider');
    }
    return context;
}; 