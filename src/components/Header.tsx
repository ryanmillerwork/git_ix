"use client"; // Mark as client component since it uses hooks (useState, useEffect)

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  AppBar, 
  Toolbar, 
  Typography, 
  FormControl, 
  InputLabel, 
  Select, 
  MenuItem, 
  TextField, 
  CircularProgress, 
  Box,
  SelectChangeEvent,
  Dialog, 
  DialogActions, 
  DialogContent, 
  DialogContentText, 
  DialogTitle,
  TextField as MuiTextField, // Alias to avoid conflict if needed later
  Select as MuiSelect, // Alias Select
  OutlinedInput, // For MultiSelect
  Checkbox, // For MultiSelect
  ListItemText, // For MultiSelect
  Snackbar, // For success/error feedback
  Alert, // For Snackbar content
  Divider, // To separate Add new option
  Button,
  Tooltip, // Import Tooltip
} from '@mui/material';
import axios from 'axios'; // Import axios
import { useEditorContext } from "@/contexts/EditorContext"; // Import context hook
import { DataGrid, GridColDef, GridRowSelectionModel, GridRowId, GridValidRowModel, GridEventListener, GridRowEditStopReasons, GridRowModesModel, GridRowModes, GridActionsCellItem, GridValueGetter, GridRowParams, GridCellParams } from '@mui/x-data-grid';
import Paper from '@mui/material/Paper'; // For DataGrid container
import Switch from '@mui/material/Switch'; // For the Active toggle

// Base URL for API calls 
// Explicitly set based on user confirmation
const API_BASE_URL = 'http://qpcs-server:3000';

interface Branch {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  protected: boolean;
}

interface User {
  username: string;
}

interface CommitInfo {
    id: string;
    version: string;
    date: string;
    time: string;
    author: string;
    message: string;
}

// Filter function to exclude retired branches
const filterRetiredBranches = (branches: Branch[]) => {
  return branches.filter(branch => !branch.name.endsWith('-retired'));
};

// Special values for dropdowns
const ADD_NEW_USER_VALUE = '__add_new__';
const MANAGE_USERS_VALUE = '__manage_users__'; // New special value
const ADD_NEW_BRANCH_VALUE = '__add_new_branch__'; // New special value
const RETIRE_BRANCH_VALUE = '__retire_branch__'; // Renamed
const REVERT_BRANCH_VALUE = '__revert_branch__'; // New

// Interface for user management data
interface UserManagementInfo extends GridValidRowModel {
    id: string; // Use username as ID
    username: string;
    branch_permissions: string[];
    is_active: boolean; // Use boolean for active status
}

export default function Header() {
  // Remove local state for branches
  // const [branches, setBranches] = useState<Branch[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  
  // Local state for loading and component-level errors
  const [loadingBranches, setLoadingBranches] = useState<boolean>(true);
  const [loadingUsers, setLoadingUsers] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // State for branch change confirmation dialog
  const [isBranchChangeDialogOpen, setBranchChangeDialogOpen] = useState(false);
  const [pendingBranchChange, setPendingBranchChange] = useState<string | null>(null);

  // Get context state and updaters
  const {
     selectedBranch, 
     updateSelectedBranch,
     selectedUser,       // Get from context
     password,           // Get from context
     updateSelectedUser, // Get from context
     updatePassword,
     branches, // Get branches from context (for multi-select in Add User)
     updateBranches, // Get updater for branches
     hasUnsavedChanges, // Get unsaved changes flag
     currentFilePath, // Need currentFilePath for reload logic
     loadFileContent, // Need loadFileContent for reload logic
     // Get context state/functions for branch state signal (NEW)
     branchStateCounter, // Add this
     incrementBranchStateCounter, // Add this
     addRetryAction, // Get the new function from context
     backendStatus, // Need backend status to know if initial fetch might fail
  } = useEditorContext();

  // --- State for Add User Modal --- 
  const [isAddUserModalOpen, setAddUserModalOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserConfirmPassword, setNewUserConfirmPassword] = useState("");
  const [newUserBranchPerms, setNewUserBranchPerms] = useState<string[]>([]); // For multiselect
  const [isAddingUser, setIsAddingUser] = useState(false); // Loading state
  const [addUserError, setAddUserError] = useState<string | null>(null); // Error state
  const [addUserSuccess, setAddUserSuccess] = useState<string | null>(null); // Success state

  // MUI Select props for multiselect
  const ITEM_HEIGHT = 48;
  const ITEM_PADDING_TOP = 8;
  const MenuProps = {
    PaperProps: {
      style: {
        maxHeight: ITEM_HEIGHT * 4.5 + ITEM_PADDING_TOP,
        width: 250,
      },
    },
  };

  // --- State for Create Branch Modal --- (NEW)
  const [isCreateBranchModalOpen, setCreateBranchModalOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [sourceBranch, setSourceBranch] = useState("");
  const [createBranchMessage, setCreateBranchMessage] = useState("");
  // Add loading/error/success state for the create branch action
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [createBranchError, setCreateBranchError] = useState<string | null>(null);
  const [createBranchSnackbar, setCreateBranchSnackbar] = useState<{open: boolean, message: string, severity: "success" | "error" | "info" | "warning"} | null>(null);

  // --- State for Retire Branch Modal --- (RENAMED)
  const [isRetireBranchModalOpen, setRetireBranchModalOpen] = useState(false);
  const [branchToRetire, setBranchToRetire] = useState("");
  const [isRetiringBranch, setIsRetiringBranch] = useState(false);
  const [retireBranchSnackbar, setRetireBranchSnackbar] = useState<{open: boolean, message: string, severity: "success" | "error" | "info" | "warning"} | null>(null);

  // --- State for Revert Branch Modal --- (NEW)
  const [isRevertModalOpen, setRevertModalOpen] = useState(false);
  const [revertTargetBranch, setRevertTargetBranch] = useState(""); // Branch to revert
  const [revertCommitsData, setRevertCommitsData] = useState<CommitInfo[]>([]);
  const [isLoadingRevertCommits, setIsLoadingRevertCommits] = useState(false);
  const [selectedCommitId, setSelectedCommitId] = useState<string | null>(null); // For single selection
  const [revertCommitMessage, setRevertCommitMessage] = useState<string>(""); // New state
  const [revertError, setRevertError] = useState<string | null>(null);
  const [isRevertingBranch, setIsRevertingBranch] = useState(false); // New loading state
  const [revertSnackbar, setRevertSnackbar] = useState<{open: boolean, message: string, severity: "success" | "error" | "warning" | "info"} | null>(null); // New snackbar state

  // --- State for Manage Users Modal --- (Enhanced for Editing)
  const [isManageUsersModalOpen, setManageUsersModalOpen] = useState(false);
  const [usersManagementData, setUsersManagementData] = useState<UserManagementInfo[]>([]);
  const [isLoadingUsersData, setIsLoadingUsersData] = useState(false);
  const [userManagementError, setUserManagementError] = useState<string | null>(null);
  // Track edited rows - { username: { branch_permissions?: string[], is_active?: boolean } }
  const [editedUsersData, setEditedUsersData] = useState<Record<string, Partial<Pick<UserManagementInfo, 'branch_permissions' | 'is_active'>>>>({});
  // State for confirmation modal (REMOVED)
  const [isUpdatingUsers, setIsUpdatingUsers] = useState(false); // Need this for disabling button
  const [manageUsersSnackbar, setManageUsersSnackbar] = useState<{open: boolean, message: string, severity: "success" | "error" | "warning" | "info"} | null>(null); // Need this for feedback

  // --- Ref to track initial mount for branch effect ---
  const isInitialBranchLoad = useRef(true);

  // --- Refactored Initial Data Fetching ---
  const fetchInitialBranches = useCallback(async () => {
    let isMounted = true; 
    setLoadingBranches(true);
    try {
        const response = await axios.get<{ branches: Branch[] }>('/api/branches');
        if (isMounted) {
            const activeBranches = filterRetiredBranches(response.data.branches || []);
            const mainBranch = activeBranches.find(b => b.name === 'main');
            const otherBranches = activeBranches.filter(b => b.name !== 'main');
            const sortedBranches = mainBranch ? [mainBranch, ...otherBranches] : activeBranches;
            updateBranches(sortedBranches);
            setFetchError(null); // Clear branch-specific error on success
        }
    } catch (err: any) {
        console.error('Error fetching branches:', err);
        if (isMounted) {
            const errorMsg = 'Failed to fetch branches';
            setFetchError(prev => prev ? `${prev}, ${errorMsg}` : errorMsg);
            // If backend is offline/checking during initial load, add this fetch to retry queue
            if (backendStatus === 'offline' || backendStatus === 'checking') {
                console.log('[Header] Backend offline during initial branch fetch. Queuing for retry.');
                // Use unique ID 'fetch-branches'
                addRetryAction('fetch-branches', fetchInitialBranches); 
            }
        }
    } finally {
        if (isMounted) {
            setLoadingBranches(false);
        }
    }
  }, [updateBranches, addRetryAction, backendStatus]); // Add dependencies

  const fetchInitialUsers = useCallback(async () => {
    let isMounted = true;
    setLoadingUsers(true);
    try {
        const response = await axios.get<User[]>('/api/users');
        if (isMounted) {
            setUsers(response.data);
            // Clear user-specific error on success (or combined error if appropriate)
            setFetchError(prev => prev?.replace(', Failed to fetch users', '').replace('Failed to fetch users', '') || null); 
        }
    } catch (err: any) {
        console.error('Error fetching users:', err);
        if (isMounted) {
            const errorMsg = 'Failed to fetch users';
            setFetchError(prev => prev ? `${prev}, ${errorMsg}` : errorMsg);
             // If backend is offline/checking during initial load, add this fetch to retry queue
            if (backendStatus === 'offline' || backendStatus === 'checking') {
                 console.log('[Header] Backend offline during initial user fetch. Queuing for retry.');
                // Use unique ID 'fetch-users'
                addRetryAction('fetch-users', fetchInitialUsers); 
            }
        }
    } finally {
        if (isMounted) {
            setLoadingUsers(false);
        }
    }
  }, [addRetryAction, backendStatus]); // Add dependencies

  // --- Effect for Initial Data Fetch ---
  useEffect(() => {
    console.log('[Header] Initial data fetch effect triggered.');
    let isMounted = true; // Add isMounted for this effect's cleanup

    if (backendStatus !== 'offline') {
        fetchInitialBranches();
        fetchInitialUsers();
    } else {
         console.log('[Header] Skipping initial fetch, backend is offline. Actions will be queued by context retry.');
        // Queue actions with IDs if skipping initial fetch
        addRetryAction('fetch-branches', fetchInitialBranches);
        addRetryAction('fetch-users', fetchInitialUsers);
        // Set loading states to false as we are not actively fetching now
        if (isMounted) { // Check isMounted before setting state
             setLoadingBranches(false);
             setLoadingUsers(false);
        }
    }
    
    // Return a cleanup function for *this* effect
    return () => {
        isMounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchInitialBranches, fetchInitialUsers, backendStatus, addRetryAction]); // Dependencies

  // EFFECT: Reload file when selectedBranch changes (moved from context)
  useEffect(() => {
    // Skip effect on initial mount
    if (isInitialBranchLoad.current) {
      isInitialBranchLoad.current = false;
      return;
    }

    // If a branch is selected and a file path exists, reload the file
    // This runs *after* the context state (selectedBranch) has updated
    if (selectedBranch && currentFilePath) {
      // Pass the *new* selectedBranch explicitly as the override
      loadFileContent(currentFilePath, selectedBranch);
    }
    // Dependencies: selectedBranch (from context), currentFilePath (from context), loadFileContent (from context)
  }, [selectedBranch, currentFilePath, loadFileContent]);

  // Function to actually update the selected branch in context
  const proceedWithBranchChange = (newBranch: string | null) => {
    if (newBranch !== null) {
        updateSelectedBranch(newBranch); // Update context
    }
    setPendingBranchChange(null); // Clear pending state
  };

  // Modified handler for branch selection change
  const handleBranchChange = (event: SelectChangeEvent<string>) => {
    const value = event.target.value as string;

    if (value === ADD_NEW_BRANCH_VALUE) {
      handleOpenCreateBranchModal();
      return;
    }
    if (value === RETIRE_BRANCH_VALUE) {
      handleOpenRetireBranchModal();
      return;
    }
    if (value === REVERT_BRANCH_VALUE) {
      handleOpenRevertModal();
      return;
    }

    // Check for unsaved changes before proceeding with regular branch change
    if (hasUnsavedChanges && value !== selectedBranch) { 
      setPendingBranchChange(value); 
      setBranchChangeDialogOpen(true);   
    } else if (value !== selectedBranch) {
      proceedWithBranchChange(value);
    }
  };

  // Handle user selection change - check for 'Add new...'
  const handleUserChange = (event: SelectChangeEvent<string>) => {
    const value = event.target.value as string;
    if (value === ADD_NEW_USER_VALUE) {
      handleOpenAddUserModal();
    } else if (value === MANAGE_USERS_VALUE) {
      handleOpenManageUsersModal(); // Open the new modal
    } else {
      // Clear password when user changes
      updatePassword(''); // Use context updater
      updateSelectedUser(value);
    }
  };
  
  // Handle password change - update context
  const handlePasswordInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    updatePassword(event.target.value);
  };

  // Add User Modal Handlers
  const handleOpenAddUserModal = () => {
    // Reset form fields when opening
    setNewUsername("");
    setNewUserEmail("");
    setNewUserPassword("");
    setNewUserConfirmPassword("");
    setNewUserBranchPerms([]);
    setAddUserError(null);
    setAddUserSuccess(null);
    setAddUserModalOpen(true);
  };

  const handleCloseAddUserModal = () => {
    setAddUserModalOpen(false);
    // Consider clearing fields here too if modal is dismissed without submitting
  };
  
  const handleNewUsernameChange = (event: React.ChangeEvent<HTMLInputElement>) => setNewUsername(event.target.value);
  const handleNewUserEmailChange = (event: React.ChangeEvent<HTMLInputElement>) => setNewUserEmail(event.target.value);
  const handleNewUserPasswordChange = (event: React.ChangeEvent<HTMLInputElement>) => setNewUserPassword(event.target.value);
  const handleNewUserConfirmPasswordChange = (event: React.ChangeEvent<HTMLInputElement>) => setNewUserConfirmPassword(event.target.value);

  const handleBranchPermissionsChange = (event: SelectChangeEvent<string[]>) => {
    const { target: { value } } = event;
    // On autofill we get a stringified value.
    setNewUserBranchPerms(typeof value === 'string' ? value.split(',') : value);
  };

  // Handler for submitting the new user request
  const handleRequestAccessSubmit = async () => {
    // Basic validation
    if (!newUsername || !newUserPassword || newUserBranchPerms.length === 0) {
      setAddUserError("Username, password, and at least one branch permission are required.");
      return;
    }
    // Add password confirmation check
    if (newUserPassword !== newUserConfirmPassword) {
        setAddUserError("Passwords do not match.");
        return;
    }

    setAddUserError(null);
    setAddUserSuccess(null);
    setIsAddingUser(true);

    try {
        const response = await axios.post('/api/users/new', {
            username: newUsername,
            email: newUserEmail, // Send email, backend handles if it's null/empty
            password: newUserPassword,
            branch_permissions: newUserBranchPerms
        });

        if (response.status === 201) {
            setAddUserSuccess(`User '${newUsername}' created successfully!`);
            // Optionally: Refresh user list automatically
            // Optionally: Select the new user automatically
            handleCloseAddUserModal(); // Close modal on success
            // We might need a mechanism to refresh the user list here
        } else {
            // Should be caught by catch block based on status codes usually
             throw new Error(response.data.error || "Failed to create user with unexpected status.")
        }

    } catch (err: any) {
        console.error("Add user error:", err);
        setAddUserError(err.response?.data?.error || err.message || "Failed to create user.");
    } finally {
        setIsAddingUser(false);
    }
  };

  // Branch Change Dialog Handlers
  const handleCloseBranchChangeDialog = () => {
    setBranchChangeDialogOpen(false);
    setPendingBranchChange(null); // Clear pending on cancel
  };

  const handleConfirmDiscardAndChangeBranch = () => {
    setBranchChangeDialogOpen(false);
    // Proceed with the branch change that was interrupted
    proceedWithBranchChange(pendingBranchChange);
  };

  // --- Create Branch Modal Handlers --- (NEW)
  const handleOpenCreateBranchModal = () => {
    // Reset form on open
    setNewBranchName("");
    setSourceBranch(selectedBranch || branches[0]?.name || ""); // Default to current or first branch
    setCreateBranchMessage("");
    setCreateBranchModalOpen(true);
  };

  const handleCloseCreateBranchModal = () => {
    setCreateBranchModalOpen(false);
  };

  const handleNewBranchNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    // Basic validation: replace spaces, disallow special chars maybe?
    setNewBranchName(event.target.value.replace(/\s+/g, '-')); 
  };

  const handleSourceBranchChange = (event: SelectChangeEvent<string>) => {
    setSourceBranch(event.target.value as string);
  };

  const handleCreateBranchMessageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setCreateBranchMessage(event.target.value);
  };

  // Helper function for Create Branch Button Tooltip
  const getCreateBranchDisabledReason = (): string => {
    const reasons = [];
    if (!newBranchName) reasons.push("New branch name is required");
    if (!sourceBranch) reasons.push("Source branch is required");
    if (!selectedUser) reasons.push("User must be selected");
    if (!password) reasons.push("Password is required");
    if (isCreatingBranch) reasons.push("Creation in progress..."); // Should rarely show
    
    if (reasons.length === 0) return ""; // Should not happen if disabled
    return reasons.join(", ");
  };

  const handleConfirmCreateBranch = async () => { // Make async
    // Basic Validation
    if (!newBranchName || !sourceBranch) {
        setCreateBranchSnackbar({ open: true, message: "New branch name and source branch are required.", severity: "error" });
        return;
    }
    if (!selectedUser || !password) {
        setCreateBranchSnackbar({ open: true, message: "Username and password are required to create a branch.", severity: "error" });
        return;
    }
    
    setIsCreatingBranch(true);
    setCreateBranchError(null);
    setCreateBranchSnackbar(null);
    handleCloseCreateBranchModal(); // Close modal immediately

    try {
      console.log("--- Sending Create Branch Request ---");
      const response = await axios.post('/api/github/create-branch', {
        username: selectedUser, // Send current user/pass for validation
        password: password,
        newBranchName: newBranchName,
        sourceBranch: sourceBranch,
        message: createBranchMessage // Optional message (backend might use later)
      });

      if (response.status === 201 && response.data.success) {
        setCreateBranchSnackbar({ open: true, message: response.data.message || `Branch '${newBranchName}' created.`, severity: "success" });
        
        // Refresh branches list automatically - USE FILTER
        try {
          console.log("Refreshing branch list...");
          const branchesResponse = await axios.get<Branch[]>('/api/branches');
          const activeBranches = filterRetiredBranches(branchesResponse.data); // Filter here
          const mainBranch = activeBranches.find(b => b.name === 'main');
          const otherBranches = activeBranches.filter(b => b.name !== 'main');
          const sortedBranches = mainBranch ? [mainBranch, ...otherBranches] : activeBranches;
          updateBranches(sortedBranches); // Update context
          console.log("Branch list updated.");
        } catch (refreshError) {
          console.error("Failed to refresh branches after creation:", refreshError);
          setCreateBranchSnackbar({ open: true, message: `Branch created, but failed to refresh list.`, severity: "warning" });
        }

        // Optionally: Select the new branch? 
        // updateSelectedBranch(newBranchName); 
      } else {
        // Should be caught by catch block based on status codes usually
        throw new Error(response.data.error || "Failed to create branch with unexpected status.");
      }

    } catch (err: any) {
      console.error("Create branch error:", err);
      const errorMsg = err.response?.data?.error || err.message || "Failed to create branch.";
      setCreateBranchSnackbar({ open: true, message: `Error: ${errorMsg}`, severity: "error" });
      // Keep modal closed, show error via snackbar
    } finally {
      setIsCreatingBranch(false);
    }
  };
  // --- End Create Branch Modal Handlers ---

  // --- Snackbar Close Handlers ---
  const handleCloseCreateBranchSnackbar = (event?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') {
      return;
    }
    setCreateBranchSnackbar(null);
  };

  // --- Retire Branch Modal Handlers --- (RENAMED)
  const handleOpenRetireBranchModal = () => {
    // Filter branches for the dropdown here too
    const activeBranches = branches.filter(b => b.name !== 'main'); // Assuming branches in context is already filtered
    setBranchToRetire(activeBranches[0]?.name || ""); // Default to first non-main, non-retired
    setRetireBranchModalOpen(true);
  };

  const handleCloseRetireBranchModal = () => {
    setRetireBranchModalOpen(false);
  };

  const handleBranchToRetireChange = (event: SelectChangeEvent<string>) => {
    setBranchToRetire(event.target.value as string);
  };

  const handleConfirmRetireBranch = async () => {
    // Basic Validation
    if (!branchToRetire) {
        setRetireBranchSnackbar({ open: true, message: "Please select a branch to retire.", severity: "error" });
        return;
    }
    if (branchToRetire === 'main') { 
        setRetireBranchSnackbar({ open: true, message: "Cannot retire the main branch.", severity: "error" });
        return;
    }
    if (!selectedUser || !password) {
        setRetireBranchSnackbar({ open: true, message: "Username and password are required to retire a branch.", severity: "error" });
        return;
    }

    setIsRetiringBranch(true);
    setRetireBranchSnackbar(null);
    handleCloseRetireBranchModal();

    try {
      console.log("--- Sending Retire Branch Request ---");
      const response = await axios.post('/api/retire-branch', { // Use new endpoint
        username: selectedUser,
        password: password,
        branchToRetire: branchToRetire, // Use correct field name
      });

      if (response.status === 200 && response.data.success) {
        setRetireBranchSnackbar({ open: true, message: response.data.message || `Branch '${branchToRetire}' retired.`, severity: "success" });
        
        if (selectedBranch === branchToRetire) {
          updateSelectedBranch(null); 
        }

        // Refresh branches list - USE FILTER
        try {
          console.log("Refreshing branch list...");
          const branchesResponse = await axios.get<Branch[]>('/api/branches');
          const activeBranches = filterRetiredBranches(branchesResponse.data); // Filter here
          const mainBranch = activeBranches.find(b => b.name === 'main');
          const otherBranches = activeBranches.filter(b => b.name !== 'main');
          const sortedBranches = mainBranch ? [mainBranch, ...otherBranches] : activeBranches;
          updateBranches(sortedBranches); // Update context
          console.log("Branch list updated.");
        } catch (refreshError) {
          console.error("Failed to refresh branches after deletion:", refreshError);
          setRetireBranchSnackbar({ open: true, message: `Branch retired, but failed to refresh list.`, severity: "warning" });
        }
      } else {
        throw new Error(response.data.error || "Failed to retire branch with unexpected status.");
      }
    } catch (err: any) {
      console.error("Retire branch error:", err);
      const errorMsg = err.response?.data?.error || err.message || "Failed to retire branch.";
      setRetireBranchSnackbar({ open: true, message: `Error: ${errorMsg}`, severity: "error" });
    } finally {
      setIsRetiringBranch(false);
    }
  };
  // --- End Retire Branch Modal Handlers ---

  // --- Snackbar Close Handlers ---
  const handleCloseRetireBranchSnackbar = (event?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') return;
    setRetireBranchSnackbar(null);
  };

  // --- Revert Branch Modal Handlers --- (NEW)
  const fetchCommitsForBranch = async (branchName: string) => {
      if (!branchName) {
          setRevertCommitsData([]);
          setRevertError(null);
          return;
      }
      console.log(`Fetching commits for: ${branchName}`);
      setIsLoadingRevertCommits(true);
      setRevertError(null);
      setRevertCommitsData([]); // Clear previous data
      setSelectedCommitId(null); // Clear selection
      try {
          const response = await axios.get<CommitInfo[]>(`/api/github/commits?branch=${encodeURIComponent(branchName)}`);
          setRevertCommitsData(response.data);
      } catch (err: any) {
          console.error("Fetch commits error:", err);
          setRevertError(err.response?.data?.error || err.message || "Failed to fetch commit history.");
          setRevertCommitsData([]);
      } finally {
          setIsLoadingRevertCommits(false);
      }
  };

  const handleOpenRevertModal = () => {
    // Default to current branch if available, otherwise first available branch
    const initialBranch = selectedBranch || branches[0]?.name || "";
    setRevertTargetBranch(initialBranch);
    setRevertCommitMessage(""); // Clear message on open
    setRevertModalOpen(true);
    // Fetch commits for the default branch
    fetchCommitsForBranch(initialBranch);
  };

  const handleCloseRevertModal = () => {
    setRevertModalOpen(false);
    setRevertCommitsData([]); // Clear data on close
    setRevertError(null);
    setSelectedCommitId(null);
    setRevertCommitMessage(""); // Clear message
  };

  const handleRevertTargetBranchChange = (event: SelectChangeEvent<string>) => {
    const newTargetBranch = event.target.value as string;
    setRevertTargetBranch(newTargetBranch);
    // Fetch commits when the target branch changes
    fetchCommitsForBranch(newTargetBranch);
  };

  // Handle selection change in DataGrid (single selection)
  const handleCommitSelectionChange = (selectionModel: GridRowSelectionModel) => {
      // For single selection, the model is an array with 0 or 1 ID
      setSelectedCommitId(selectionModel.length > 0 ? String(selectionModel[0]) : null);
  };

  // Handler for the new commit message input
  const handleRevertMessageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      setRevertCommitMessage(event.target.value);
  };

  const handleConfirmRevert = async () => { // Make async
      if (!revertTargetBranch || !selectedCommitId || !selectedUser || !password) {
          setRevertSnackbar({ open: true, message: "Target branch, commit selection, username, and password are required.", severity: "error" });
          return;
      }

      setIsRevertingBranch(true);
      setRevertSnackbar(null);
      setRevertError(null); // Clear previous errors

      console.log("--- Sending Revert Branch Request --- ");
      console.log(" Target Branch:", revertTargetBranch);
      console.log(" Revert to Commit ID:", selectedCommitId);

      try {
          const response = await axios.post('/api/revert-branch', {
              username: selectedUser,
              password: password,
              branchToRevert: revertTargetBranch,
              commitShaToRevertTo: selectedCommitId,
              message: revertCommitMessage, // Send the commit message
          });

          if (response.status === 200 && response.data.success) {
              setRevertSnackbar({ open: true, message: response.data.message || `Branch '${revertTargetBranch}' successfully reverted.`, severity: "success" });
              handleCloseRevertModal();

              // If the reverted branch is the currently selected branch, reload the current file
              if (revertTargetBranch === selectedBranch && currentFilePath) {
                  console.log(`[Revert Success] Reloading file ${currentFilePath} for reverted branch ${selectedBranch}`);
                  loadFileContent(currentFilePath, selectedBranch); 
              }

              // If the reverted branch is the currently selected one, signal a state change (NEW)
              if (revertTargetBranch === selectedBranch) {
                 incrementBranchStateCounter();
              }

          } else {
              throw new Error(response.data.error || "Failed to revert branch with unexpected status.");
          }

      } catch (err: any) {
          console.error("Revert branch error:", err);
          const errorMsg = err.response?.data?.error || err.message || "Failed to revert branch.";
          setRevertSnackbar({ open: true, message: `Error: ${errorMsg}`, severity: "error" });
      } finally {
          setIsRevertingBranch(false);
      }
  };
  // --- End Revert Branch Modal Handlers ---

  // --- Snackbar Close Handlers ---
  const handleCloseRevertSnackbar = (event?: React.SyntheticEvent | Event, reason?: string) => {
      if (reason === 'clickaway') return;
      setRevertSnackbar(null);
  };

  // --- Manage Users Modal Handlers --- (NEW - Editing Logic)
  const fetchUsersData = async () => {
      setIsLoadingUsersData(true);
      setUserManagementError(null);
      setUsersManagementData([]);
      try {
          console.log("Fetching ALL users data for management..."); // Emphasize 'ALL'
          // Ensure this path points to the /api/users/all route
          const response = await axios.get<any[]>(`/api/users/all`); 
          // Map the response
           const formattedData = response.data.map(user => ({
               id: user.username, // Use username as id for DataGrid
               username: user.username,
               branch_permissions: Array.isArray(user.branch_permissions) ? user.branch_permissions : [],
               is_active: user.active ?? user.is_active ?? false // Handle potential naming difference (active vs is_active)
           }));
          setUsersManagementData(formattedData);
          console.log("Users data fetched and formatted:", formattedData);
      } catch (err: any) {
          console.error("Fetch all users error:", err);
          setUserManagementError(err.response?.data?.error || err.message || "Failed to fetch user data.");
          setUsersManagementData([]);
      } finally {
          setIsLoadingUsersData(false);
      }
  };

  const handleOpenManageUsersModal = () => {
    setManageUsersModalOpen(true);
    setEditedUsersData({}); // Clear edits when opening
    fetchUsersData(); // Fetch data when modal opens
  };

  const handleCloseManageUsersModal = () => {
    setManageUsersModalOpen(false);
  };

  const processRowUpdate = React.useCallback(
    (newRow: UserManagementInfo, oldRow: UserManagementInfo): UserManagementInfo => {
        console.log("[Process Row Update] Started", { oldRow_id: oldRow.id, newRow_id: newRow.id, oldRow_perms: oldRow.branch_permissions, newRow_perms: newRow.branch_permissions, oldRow_active: oldRow.is_active, newRow_active: newRow.is_active });

        const updatedUserPatch: Partial<Pick<UserManagementInfo, 'branch_permissions' | 'is_active'>> = {};
        let hasChanged = false;

        // --- Check branch permissions change ---
        const oldPermsArray = oldRow.branch_permissions.slice().sort();
        let parsedNewPermsArray = oldPermsArray;
        let isPermissionsChanged = false;
        const permissionsValue = newRow.branch_permissions;

        // Explicitly check if it's a string before splitting
        if (typeof permissionsValue === 'string') {
            // Assert type as string for split
            parsedNewPermsArray = (permissionsValue as string).split(',') 
                              .map((p: string) => p.trim()) 
                              .filter((p: string) => p !== '') 
                              .sort();
            isPermissionsChanged = JSON.stringify(oldPermsArray) !== JSON.stringify(parsedNewPermsArray);
             console.log("[Process Row Update] Permissions Parsed:", parsedNewPermsArray, "Was Changed:", isPermissionsChanged);
        } else if (Array.isArray(permissionsValue)) {
             // Value might be array if only Active was toggled
             parsedNewPermsArray = permissionsValue.slice().sort();
             isPermissionsChanged = JSON.stringify(oldPermsArray) !== JSON.stringify(parsedNewPermsArray);
             console.log("[Process Row Update] Permissions Input (Array):", parsedNewPermsArray, "Was Changed:", isPermissionsChanged);
        }
        // Else: not string or array, ignore

        if (isPermissionsChanged) {
            updatedUserPatch.branch_permissions = parsedNewPermsArray;
            hasChanged = true;
        }

        // --- Check active status change ---
        let isActiveChanged = false;
        if (oldRow.is_active !== newRow.is_active) {
            updatedUserPatch.is_active = newRow.is_active;
            hasChanged = true;
            isActiveChanged = true;
             console.log(`[Process Row Update] Active status changed for ${newRow.username}: ${newRow.is_active}`);
        }

         console.log("[Process Row Update] Change Flags:", { isPermissionsChanged, isActiveChanged, hasChanged });

        // --- Update editedUsersData state ---
        if (hasChanged) {
            console.log(`[Process Row Update] Changes detected for ${newRow.username}. Staging edits:`, updatedUserPatch);
            setEditedUsersData(prev => {
                 console.log("[Process Row Update] Current staged edits (before update):", prev);
                 const newState = {
                    ...prev,
                    [newRow.username]: { ...(prev[newRow.username] || {}), ...updatedUserPatch }
                 };
                 console.log("[Process Row Update] New staged edits state (after update):", newState);
                 return newState;
            });
        } else {
             console.log(`[Process Row Update] No effective change detected for ${newRow.username} in this event.`);
             // **REMOVED**: Complex logic to check against original state here.
        }

        // Return the row DataGrid should use internally.
        // This needs to have the *parsed* permissions if they came in as a string and changed.
         const finalRowForRowCache = { ...newRow, branch_permissions: isPermissionsChanged ? parsedNewPermsArray : oldRow.branch_permissions };
         console.log("[Process Row Update] Returning row for DataGrid cache:", finalRowForRowCache);
         return finalRowForRowCache;
    },
    []
  );

   const handleProcessRowUpdateError = React.useCallback((error: Error) => {
        console.error("DataGrid Row Update Error:", error);
        setManageUsersSnackbar({ open: true, message: `Error processing update: ${error.message}`, severity: 'error' });
    }, []);

    const handleRowEditStop: GridEventListener<'rowEditStop'> = (params, event) => {
        console.log(`[handleRowEditStop] Event triggered. Reason: ${params.reason}`, params);
        // REMOVE the conditional preventDefault for rowFocusOut
        // Allow default behavior (which includes committing the row)
    };

    const handleConfirmUpdateUsers = async () => {
      if (!selectedUser || !password) {
          setManageUsersSnackbar({ open: true, message: "Admin user/password required for updates.", severity: "error" });
          return;
      }
       if (Object.keys(editedUsersData).length === 0) {
            setManageUsersSnackbar({ open: true, message: "No changes to update.", severity: "info" });
            return;
       }

      setIsUpdatingUsers(true);
      setManageUsersSnackbar(null);

      const updatePromises: Promise<any>[] = [];
      const usersToUpdate = Object.keys(editedUsersData);

      console.log("--- Updating Users ---", editedUsersData);

      usersToUpdate.forEach(username => {
          const edits = editedUsersData[username];
          if (username === 'admin') { 
             console.warn("Skipping update attempt for admin user.");
             return;
          }

          const payload: any = {
              adminUsername: selectedUser,
              adminPassword: password,
              targetUsername: username,
          };
          let needsUpdate = false;
          if (edits.hasOwnProperty('is_active')) {
               payload.action = edits.is_active ? 'activate' : 'deactivate';
               needsUpdate = true;
          }
          if (edits.hasOwnProperty('branch_permissions')) {
               payload.branch_permissions = edits.branch_permissions; 
               needsUpdate = true;
               if (!payload.action) payload.action = 'update_perms';
          }

          if (needsUpdate) {
              console.log("Sending update for user:", username, "Payload:", payload);
              updatePromises.push(
                  axios.post('/api/users/update-status', payload)
              );
          }
      });

       if (updatePromises.length === 0) {
           console.log("No actual updates to send (perhaps only admin was edited).");
           setIsUpdatingUsers(false);
           return;
      }

      try {
          const results = await Promise.allSettled(updatePromises);
          let successCount = 0;
          let failCount = 0;
          let errorMessages: string[] = [];
          const updatedUsernames = usersToUpdate.filter(u => u !== 'admin');

          results.forEach((result, index) => {
               const username = updatedUsernames[index]; 
               if (!username) return;

               if (result.status === 'fulfilled' && result.value.data.success) {
                  successCount++;
                  console.log(`Update successful for ${username}:`, result.value.data.message);
               } else {
                  failCount++;
                  const errorMsg = result.status === 'rejected'
                      ? (result.reason.response?.data?.error || result.reason.message)
                      : result.value.data.error;
                   console.error(`Update failed for ${username}:`, errorMsg);
                  errorMessages.push(`${username}: ${errorMsg || 'Unknown error'}`);
               }
          });

           let finalMessage = "";
           let finalSeverity: "success" | "warning" | "error" | "info" = "info";

           if (failCount === 0 && successCount > 0) {
               // All succeeded
               finalMessage = `Successfully updated ${successCount} user(s).`;
               finalSeverity = "success";
               handleCloseManageUsersModal(); // Close modal on full success

               // *** Refetch ACTIVE users for the main dropdown ***
               console.log("Refreshing active user list for dropdown...");
               setLoadingUsers(true); // Indicate loading in the dropdown
               axios.get<User[]>('/api/users')
                 .then(response => {
                   setUsers(response.data); // Update the state for the main dropdown
                 })
                 .catch(err => {
                   console.error('Error refetching active users:', err);
                   // Show a specific error or append to existing snackbar?
                   // For now, let the main error state handle it if needed, or add another snackbar.
                   setFetchError(prev => prev ? `${prev}, Failed to refresh active user list` : 'Failed to refresh active user list');
                   setManageUsersSnackbar({ open: true, message: "User updates successful, but failed to refresh user dropdown.", severity: "warning" });
                 })
                 .finally(() => {
                   setLoadingUsers(false);
                 });
               // *** End refetch ***

           } else if (successCount > 0 && failCount > 0) {
               // Partial success
               finalMessage = `Updated ${successCount} user(s), but failed ${failCount}: ${errorMessages.join('; ')}`;
               finalSeverity = "warning";
               // Keep modal open to show errors clearly?
           } else if (failCount > 0) {
                // All failed
               finalMessage = `Failed to update ${failCount} user(s): ${errorMessages.join('; ')}`;
               finalSeverity = "error";
               // Keep modal open
           } else {
                // No updates were actually sent (e.g., only admin edits attempted)
                finalMessage = "No user updates were performed.";
                finalSeverity = "info";
                // Don't need to close modal as likely nothing happened
           }

           setManageUsersSnackbar({
               open: true,
               message: finalMessage,
               severity: finalSeverity
           });
          // fetchUsersData(); // Refetch ALL users for the modal grid (already called)

      } catch (error) {
          console.error("Unexpected error during bulk update:", error);
          setManageUsersSnackbar({ open: true, message: "An unexpected error occurred during the update process.", severity: "error" });
           // fetchUsersData(); // Still try to refetch -- REMOVED from here, handled in success/fail logic?
      } finally {
          setIsUpdatingUsers(false);
           // We refetch user data within the success/error blocks now
           // fetchUsersData(); // REMOVE from here if handled above
      }
  };

   const handleCloseManageUsersSnackbar = (event?: React.SyntheticEvent | Event, reason?: string) => {
        if (reason === 'clickaway') return;
        setManageUsersSnackbar(null);
    };

  // Define columns for the Manage Users DataGrid (Refining Types)
  const userManagementColumns: GridColDef<UserManagementInfo>[] = React.useMemo(() => [
      { field: 'username', headerName: 'User', width: 150, editable: false },
      {
          field: 'branch_permissions',
          headerName: 'Branch Permissions (comma-separated)',
          flex: 1,
           // editable prop expects boolean | undefined. Function might work but causes type issues.
           // We control editability via processRowUpdate/backend anyway, so just set true.
           // We will prevent saving admin changes in handleConfirmUpdateUsers.
           editable: true, // Simplified: Always allow editing UI, prevent saving admin changes later
           valueGetter: (value: any) => // Use `any` for valueGetter if specific type causes issues
               (Array.isArray(value) ? value.join(', ') : ''),
           type: 'string', // Treat as string for editing
      },
      {
          field: 'is_active',
          headerName: 'Active',
          width: 100,
           editable: true, // Simplified: Always allow editing UI, prevent saving admin changes later
          type: 'boolean',
           renderCell: (params: GridCellParams) => (
              <Switch checked={!!params.value} disabled size="small" />
           ),
           renderEditCell: (params: GridCellParams<UserManagementInfo, any>) => { 
                const { id, field, value, api } = params;
                const username = params.row.username; // Get username for state update

                const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
                    const newValue = event.target.checked;
                    // Update DataGrid internal state
                    api.setEditCellValue({ id, field, value: newValue });

                    // *** ALSO Update our tracked edits state immediately ***
                    setEditedUsersData(prev => {
                         // Check against original data to see if this change reverts it
                         const originalUser = usersManagementData.find(u => u.id === id);
                         const originalValue = originalUser?.is_active ?? false; // Default if user not found

                         const currentEdits = prev[username] || {};
                         const otherEdits = { ...currentEdits }; // Copy other potential edits (like permissions)
                         delete otherEdits.is_active; // Remove is_active temporarily

                         // If the new value matches the original AND there are no other staged edits, remove the user entry
                         if (newValue === originalValue && Object.keys(otherEdits).length === 0) {
                             console.log(`Active status for ${username} reverted to original. Removing from staged edits.`);
                             const { [username]: _, ...rest } = prev; // Remove user entry
                             return rest;
                         } else {
                              // Otherwise, update/add the is_active field for this user
                              console.log(`Staging active status change for ${username} to ${newValue}`);
                              return {
                                 ...prev,
                                 [username]: {
                                     ...currentEdits, // Keep existing staged edits
                                     is_active: newValue // Add/overwrite active status
                                 }
                              };
                         }
                    });
                };
                // The Switch component itself for editing
                return <Switch checked={!!value} onChange={handleChange} autoFocus size="small" />;
           }
      },
  ], [usersManagementData]); // Add usersManagementData as dependency for comparison in handleChange


  // --- Render ---
  return (
    <>
      {/* AppBar */}
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1, backgroundColor: '#2c3e50' }}>
      <Toolbar>
        {/* Remove the Typography component */}
        {/* <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
          Git IX
        </Typography> */}
        
        {/* Add an empty Box with flexGrow to push items to the right */}
        <Box sx={{ flexGrow: 1 }} />

        {/* Display Error if any */}
        {fetchError && (
            <Typography color="error" variant="caption" sx={{ mr: 2 }}>
                {fetchError}
            </Typography>
        )}

        {/* Branch Selector */}
          <FormControl variant="standard" sx={{ minWidth: 150, mr: 2 }}>
            <InputLabel id="branch-select-label" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>Branch</InputLabel>
          <Select
            labelId="branch-select-label"
            id="branch-select"
            value={selectedBranch || ''}
            onChange={handleBranchChange}
            disabled={loadingBranches || fetchError !== null}
              sx={{
                color: 'white',
                '&::before': { borderBottomColor: 'rgba(255, 255, 255, 0.5)' }, // Standard underline
                '&::after': { borderBottomColor: 'white' }, // Focused underline
                '&:hover:not(.Mui-disabled)::before': { borderBottomColor: 'white' }, // Hover underline
                '.MuiSvgIcon-root': { color: 'white' },
              }}
            >
              {/* Loading Indicator */}
              {loadingBranches && (
              <MenuItem disabled value="loading">
                  <CircularProgress size={20} sx={{ mr: 1 }} /> Loading...
              </MenuItem>
              )}
              {/* Error Message */}
              {fetchError && !loadingBranches && branches.length === 0 && (
                <MenuItem disabled value="error">
                  <Typography color="error" variant="caption">Error loading branches</Typography>
              </MenuItem>
              )}
              {/* Branch List */}
              {!loadingBranches && branches.map((branch) => (
                <MenuItem key={branch.name} value={branch.name}>
                  {branch.name}
                  {branch.name === 'main' && <Typography variant="caption" sx={{ ml: 0.5 }}>(Default)</Typography>}
                </MenuItem>
              ))}
              {/* Divider between branches and actions - Remove admin check */}
              { !loadingBranches && branches.length > 0 && <Divider />}
              {/* Add New Branch Option - Keep admin check */}
              {selectedUser === 'admin' && !loadingBranches && branches.length > 0 && ( <MenuItem value={ADD_NEW_BRANCH_VALUE}><em>+ New...</em></MenuItem> )}
              {/* Revert Branch Option - No admin check */}
              {!loadingBranches && branches.length > 0 && ( <MenuItem value={REVERT_BRANCH_VALUE}><em>↪ Revert...</em></MenuItem> )}
              {/* Retire Branch Option - Keep admin check */} 
              {selectedUser === 'admin' && !loadingBranches && branches.filter(b => b.name !== 'main').length > 0 && ( <MenuItem value={RETIRE_BRANCH_VALUE}><em>- Retire...</em></MenuItem> )}
          </Select>
        </FormControl>

        {/* User Selector */}
          <FormControl variant="standard" sx={{ minWidth: 120, mr: 2 }}>
            <InputLabel id="user-select-label" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>User</InputLabel>
          <MuiSelect
            labelId="user-select-label"
            id="user-select"
            value={selectedUser || ''}
            onChange={handleUserChange}
            disabled={loadingUsers || fetchError !== null}
              sx={{
                color: 'white',
                '&::before': { borderBottomColor: 'rgba(255, 255, 255, 0.5)' }, // Standard underline
                '&::after': { borderBottomColor: 'white' }, // Focused underline
                '&:hover:not(.Mui-disabled)::before': { borderBottomColor: 'white' }, // Hover underline
                '.MuiSvgIcon-root': { color: 'white' },
              }}
            >
              {/* Loading Indicator */}
              {loadingUsers && (
               <MenuItem disabled value="">
                  <CircularProgress size={20} sx={{ mr: 1 }} /> Loading...
              </MenuItem>
              )}
              {/* Error Message */}
              {fetchError && !loadingUsers && users.length === 0 && (
               <MenuItem disabled value="">
                  <Typography color="error" variant="caption">Error loading users</Typography>
              </MenuItem>
              )}
              {/* User List */}
              {!loadingUsers && users.map((user) => (
                <MenuItem key={user.username} value={user.username}>
                  {user.username}
                </MenuItem>
              ))}
              {/* Add new user option */}
              {!loadingUsers && !fetchError && ( // Only show if not loading
                  [
                      <Divider key="divider" />,
                      <MenuItem key={ADD_NEW_USER_VALUE} value={ADD_NEW_USER_VALUE}>
                          <ListItemText primary="+ New..." />
                      </MenuItem>
                  ]
              )}
              {/* Manage Users Option - Conditional */} 
              {selectedUser === 'admin' && !loadingUsers && !fetchError && (
                   <MenuItem key={MANAGE_USERS_VALUE} value={MANAGE_USERS_VALUE}>
                       <em>Manage...</em>
              </MenuItem>
              )}
          </MuiSelect>
        </FormControl>

          {/* Password Field */}
        <MuiTextField
          label="Password"
          type="password"
            variant="standard" // Change variant to standard
            value={password} 
            onChange={handlePasswordInputChange} 
          disabled={fetchError !== null} 
          sx={{ 
            mr: 2, 
            width: '150px', 
              '& .MuiInput-underline:before': { borderBottomColor: 'rgba(255, 255, 255, 0.5)' }, // Standard underline
              '& .MuiInput-underline:after': { borderBottomColor: 'white' }, // Focused underline
              '& .MuiInput-underline:hover:not(.Mui-disabled):before': { borderBottomColor: 'white' }, // Hover underline
              '& .MuiInputBase-input': { color: 'white' }, // Input text color for standard variant
              '& .MuiInputLabel-root': { color: 'rgba(255, 255, 255, 0.7)'}, // Label color
            '& .MuiInputLabel-root.Mui-focused': { color: 'white' } // Label color when focused
           }}
        />
        
        {/* Add other header items like profile menu or notifications here later */}

      </Toolbar>
      </AppBar>

      {/* --- Add User Modal --- */}
      <Dialog open={isAddUserModalOpen} onClose={handleCloseAddUserModal} maxWidth="sm" fullWidth>
          <DialogTitle>Add New User Access Request</DialogTitle>
          <DialogContent>
              {addUserError && <Alert severity="error" sx={{ mb: 2 }}>{addUserError}</Alert>}
              {addUserSuccess && <Alert severity="success" sx={{ mb: 2 }}>{addUserSuccess}</Alert>} 
              
              <MuiTextField
                  required
                  margin="dense"
                  id="new-username"
                  label="Username"
                  type="text"
                  fullWidth
                  variant="outlined"
                  value={newUsername}
                  onChange={handleNewUsernameChange}
                  disabled={isAddingUser}
                  sx={{ mb: 2 }}
              />
              <MuiTextField
                  margin="dense"
                  id="new-user-email"
                  label="Email (Optional)"
                  type="email"
                  fullWidth
                  variant="outlined"
                  value={newUserEmail}
                  onChange={handleNewUserEmailChange}
                  disabled={isAddingUser}
                  sx={{ mb: 2 }}
              />
              <MuiTextField
                  required
                  margin="dense"
                  id="new-user-password"
                  label="Password"
                  type="password"
                  fullWidth
                  variant="outlined"
                  value={newUserPassword}
                  onChange={handleNewUserPasswordChange}
                  disabled={isAddingUser}
                  sx={{ mb: 2 }}
              />
              <MuiTextField
                  required
                  margin="dense"
                  id="new-user-confirm-password"
                  label="Confirm Password"
                  type="password"
                  fullWidth
                  variant="outlined"
                  value={newUserConfirmPassword}
                  onChange={handleNewUserConfirmPasswordChange}
                  disabled={isAddingUser}
                  error={newUserPassword !== newUserConfirmPassword && newUserConfirmPassword !== ''}
                  helperText={newUserPassword !== newUserConfirmPassword && newUserConfirmPassword !== '' ? "Passwords do not match" : ""}
                  sx={{ mb: 2 }}
              />
              
              {/* Branch Permissions MultiSelect */} 
              <FormControl fullWidth sx={{ mt: 1 }}>
                  <InputLabel id="branch-perms-label">Branch Permissions *</InputLabel>
                  <MuiSelect
                    labelId="branch-perms-label"
                    id="branch-perms-select"
                    multiple
                    required
                    value={newUserBranchPerms}
                    onChange={handleBranchPermissionsChange}
                    input={<OutlinedInput label="Branch Permissions *" />}
                    renderValue={(selected) => selected.join(', ')}
                    MenuProps={MenuProps}
                    disabled={loadingBranches || isAddingUser} // Disable if branches loading or user adding
                  >
                    {loadingBranches ? (
                       <MenuItem disabled>Loading branches...</MenuItem>
                    ) : branches.map((branch) => (
                      <MenuItem key={branch.name} value={branch.name}>
                        <Checkbox checked={newUserBranchPerms.indexOf(branch.name) > -1} />
                        <ListItemText primary={branch.name} />
                      </MenuItem>
                    ))}
                  </MuiSelect>
              </FormControl>

          </DialogContent>
          <DialogActions>
              <Button onClick={handleCloseAddUserModal} disabled={isAddingUser}>Cancel</Button>
              <Button onClick={handleRequestAccessSubmit} disabled={isAddingUser} variant="contained">
                  {isAddingUser ? <CircularProgress size={24} /> : "Request Access"}
              </Button>
          </DialogActions>
      </Dialog>
      
      {/* Snackbar for Add User Status (optional, can reuse saveSnackbar or make separate) */} 
      {/* We used Alert inside the modal for now */} 

      {/* Branch Change Confirmation Dialog */}
      <Dialog
        open={isBranchChangeDialogOpen}
        onClose={handleCloseBranchChangeDialog}
        aria-labelledby="branch-change-dialog-title"
        aria-describedby="branch-change-dialog-description"
      >
        <DialogTitle id="branch-change-dialog-title">
          Discard Unsaved Changes?
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="branch-change-dialog-description">
            You have unsaved changes in the current file. Changing the branch will discard these changes. Are you sure you want to proceed?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseBranchChangeDialog}>Cancel</Button>
          <Button onClick={handleConfirmDiscardAndChangeBranch} color="warning"> 
            Discard Changes & Change Branch
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create Branch Modal --- (NEW) */}
      <Dialog open={isCreateBranchModalOpen} onClose={handleCloseCreateBranchModal}>
        <DialogTitle>Create New Branch</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}> {/* Reduce top padding */} 
          <TextField
            autoFocus
            required
            margin="dense"
            id="new-branch-name"
            label="New Branch Name"
            type="text"
            fullWidth
            variant="standard"
            value={newBranchName}
            onChange={handleNewBranchNameChange}
            helperText="Spaces will be replaced with hyphens."
          />
          <FormControl required margin="dense" fullWidth variant="standard">
            <InputLabel id="source-branch-select-label">Source Branch</InputLabel>
            <Select
              labelId="source-branch-select-label"
              id="source-branch-select"
              value={sourceBranch}
              onChange={handleSourceBranchChange}
              label="Source Branch"
            >
              {/* Populate with existing branches */} 
              {branches.map((branch) => (
                <MenuItem key={branch.name} value={branch.name}>
                  {branch.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            margin="dense"
            id="create-branch-message"
            label="Commit Message (Optional)"
            placeholder="Initial commit message for new branch..."
            type="text"
            fullWidth
            multiline
            rows={3}
            variant="standard"
            value={createBranchMessage}
            onChange={handleCreateBranchMessageChange}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseCreateBranchModal} disabled={isCreatingBranch}>Cancel</Button>
          {/* Wrap the Button in Tooltip and Span for disabled state */}
          <Tooltip title={getCreateBranchDisabledReason()} arrow 
            // Always provide boolean to open prop
            open={ !!((!newBranchName || !sourceBranch || !selectedUser || !password) && !isCreatingBranch) }
          >
            {/* Span wrapper needed for tooltip on disabled button */}
            <span> 
              <Button 
                onClick={handleConfirmCreateBranch} 
                disabled={!newBranchName || !sourceBranch || isCreatingBranch || !selectedUser || !password}
              >
                {isCreatingBranch ? <CircularProgress size={24} /> : "Create Branch"}
              </Button>
            </span>
          </Tooltip>
        </DialogActions>
      </Dialog>

      {/* Snackbar for Create Branch Status --- (NEW) */}
      <Snackbar 
        open={createBranchSnackbar?.open || false} 
        autoHideDuration={6000} 
        onClose={handleCloseCreateBranchSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleCloseCreateBranchSnackbar} severity={createBranchSnackbar?.severity || 'info'} sx={{ width: '100%' }}>
          {createBranchSnackbar?.message}
        </Alert>
      </Snackbar>

      {/* Retire Branch Modal --- (RENAMED & UPDATED) */}
      <Dialog open={isRetireBranchModalOpen} onClose={handleCloseRetireBranchModal}>
        <DialogTitle>Retire Branch</DialogTitle> {/* Update title */} 
        <DialogContent sx={{ pt: '8px !important' }}>
          <DialogContentText sx={{ mb: 2 }}>
            Select the branch to retire. It will be renamed to '[branch-name]-retired'. {/* Update text */} 
          </DialogContentText>
          <FormControl required margin="dense" fullWidth variant="standard">
            <InputLabel id="retire-branch-select-label">Branch to Retire</InputLabel> {/* Update label */} 
            <Select
              labelId="retire-branch-select-label"
              id="retire-branch-select"
              value={branchToRetire}
              onChange={handleBranchToRetireChange}
              label="Branch to Retire"
            >
              {/* Populate with ACTIVE, deletable branches */} 
              {branches // Assuming branches in context is already filtered
                .filter(branch => branch.name !== 'main') // Ensure main is excluded
                .map((branch) => (
                  <MenuItem key={branch.name} value={branch.name}>
                    {branch.name}
                  </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseRetireBranchModal} disabled={isRetiringBranch}>Cancel</Button>
          <Button 
            onClick={handleConfirmRetireBranch} 
            disabled={!branchToRetire || isRetiringBranch || !selectedUser || !password} 
            // Remove color="error"
          >
            {isRetiringBranch ? <CircularProgress size={24} /> : "Retire Branch"} {/* Update text */} 
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbars */}
      {/* ... Create Branch Snackbar ... */}
      {/* Retire Branch Snackbar --- (RENAMED) */}
      <Snackbar 
        open={retireBranchSnackbar?.open || false} 
        autoHideDuration={6000} 
        onClose={handleCloseRetireBranchSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleCloseRetireBranchSnackbar} severity={retireBranchSnackbar?.severity || 'info'} sx={{ width: '100%' }}>
          {retireBranchSnackbar?.message}
        </Alert>
      </Snackbar>

      {/* Revert Branch Modal --- (NEW) */}
      <Dialog open={isRevertModalOpen} onClose={handleCloseRevertModal} fullWidth maxWidth="md">
          <DialogTitle>Revert Branch to Previous Version</DialogTitle>
          <DialogContent sx={{ pt: '8px !important', minHeight: '500px', display: 'flex', flexDirection: 'column' }}>
              <FormControl required margin="dense" fullWidth variant="standard" sx={{ mb: 2 }}>
                  <InputLabel id="revert-target-branch-select-label">Target Branch to Revert</InputLabel>
                  <Select
                      labelId="revert-target-branch-select-label"
                      id="revert-target-branch-select"
                      value={revertTargetBranch}
                      onChange={handleRevertTargetBranchChange}
                      label="Target Branch to Revert"
                  >
                      {branches.map((branch) => (
                          <MenuItem key={branch.name} value={branch.name}>
                              {branch.name}
                              {branch.name === 'main' && <Typography variant="caption" sx={{ ml: 0.5 }}>(Default)</Typography>}
                          </MenuItem>
                      ))}
                  </Select>
              </FormControl>

              <Typography variant="body2" sx={{ mb: 1 }}>
                  Revert <Typography component="span" fontWeight="bold">{revertTargetBranch || '...'}</Typography> to the state <em>following</em> the selected commit.
              </Typography>

              {/* DataGrid Container */} 
              <Paper elevation={1} sx={{ flexGrow: 1, height: '100%', overflow: 'hidden' }}>{/* Ensure Paper takes space */}
                  {(revertCommitsData.length > 0) && (
                    <DataGrid
                        rows={revertCommitsData}
                        columns={[
                          // Define columns inline or separately
                          {
                            field: 'version',
                            headerName: 'Version',
                            width: 100,
                            renderCell: (params) => {
                              const isFirstRow = params.row.id === (revertCommitsData[0]?.id ?? null);
                              const content = params.value;
                              // Keep opacity for first row, remove custom tooltip
                              return (
                                <span style={{ opacity: isFirstRow ? 0.6 : 1, display: 'block', width: '100%' }}>
                                  {content}
                                </span>
                              );
                            },
                          },
                          {
                            field: 'date',
                            headerName: 'Date',
                            width: 120,
                            renderCell: (params) => {
                              const isFirstRow = params.row.id === (revertCommitsData[0]?.id ?? null);
                              const content = params.value;
                              // Keep opacity for first row, remove custom tooltip
                              return (
                                <span style={{ opacity: isFirstRow ? 0.6 : 1, display: 'block', width: '100%' }}>
                                  {content}
                                </span>
                              );
                            },
                          },
                          {
                            field: 'time',
                            headerName: 'Time',
                            width: 100,
                            renderCell: (params) => {
                              const isFirstRow = params.row.id === (revertCommitsData[0]?.id ?? null);
                              const content = params.value;
                              // Keep opacity for first row, remove custom tooltip
                              return (
                                <span style={{ opacity: isFirstRow ? 0.6 : 1, display: 'block', width: '100%' }}>
                                  {content}
                                </span>
                              );
                            },
                          },
                          {
                            field: 'author',
                            headerName: 'Author',
                            width: 120,
                            renderCell: (params) => {
                              const isFirstRow = params.row.id === (revertCommitsData[0]?.id ?? null);
                              const content = params.value;
                              // Keep opacity for first row, remove custom tooltip
                              return (
                                <span style={{ opacity: isFirstRow ? 0.6 : 1, display: 'block', width: '100%' }}>
                                  {content}
                                </span>
                              );
                            },
                          },
                          {
                            field: 'message',
                            headerName: 'Message',
                            flex: 1, // Use flex for remaining space
                            renderCell: (params) => {
                                const isFirstRow = params.row.id === (revertCommitsData[0]?.id ?? null);
                                // Apply standard overflow tooltip to all rows, but style first row differently
                                return (
                                    <Tooltip title={params.value || ''} arrow>
                                        {/* Wrap text to allow Tooltip on overflow */}
                                        <Typography
                                            variant="body2" // Match grid style
                                            noWrap
                                            sx={{
                                                opacity: isFirstRow ? 0.6 : 1, // Apply opacity conditionally
                                                overflow: 'hidden', 
                                                textOverflow: 'ellipsis', 
                                                width: '100%'
                                            }}
                                        >
                                            {params.value}
                                        </Typography>
                                    </Tooltip>
                                );
                            },
                          },
                        ]}
                        rowSelectionModel={selectedCommitId ? [selectedCommitId] : []} // Control selection
                        onRowSelectionModelChange={handleCommitSelectionChange} // Handle selection changes
                        loading={isLoadingRevertCommits}
                        getRowId={(row) => row.id} // Specify the unique ID field
                        isRowSelectable={(params: GridRowParams<CommitInfo>) =>
                          // Disable selection for the first row (most recent commit)
                          params.row.id !== (revertCommitsData[0]?.id ?? null)
                        }
                        sx={{
                          border: 0,
                          // Apply cursor style globally to the first row
                          '& .MuiDataGrid-row:first-of-type': {
                            cursor: 'not-allowed',
                            // Opacity handled by renderCell now
                            // opacity: 0.6, 
                          },
                        }}
                        density="compact"
                        hideFooter // Hide pagination for now if only showing 10
                    />
                  )}
              </Paper>
              {/* Add Commit Message Field */} 
              <TextField
                  margin="dense"
                  id="revert-commit-message"
                  label="Commit Message"
                  type="text"
                  fullWidth
                  variant="standard"
                  value={revertCommitMessage}
                  onChange={handleRevertMessageChange}
                  sx={{ mt: 2 }}
              />
              {revertError && (
                  <Alert severity="error" sx={{ mt: 1 }}>{revertError}</Alert>
              )}
          </DialogContent>
          <DialogActions>
              <Button onClick={handleCloseRevertModal} disabled={isRevertingBranch}>Cancel</Button>
              <Button 
                  onClick={handleConfirmRevert}
                  disabled={!revertTargetBranch || !selectedCommitId || isLoadingRevertCommits || isRevertingBranch}
                  color="warning"
              >
                  {isRevertingBranch ? <CircularProgress size={24} /> : "Revert Branch"}
              </Button>
          </DialogActions>
      </Dialog>

      {/* Snackbars */} 
      {/* ... Create Branch Snackbar, Retire Branch Snackbar ... */}
      {/* Revert Branch Snackbar --- (NEW) */}
      <Snackbar 
          open={revertSnackbar?.open || false} 
          autoHideDuration={6000} 
          onClose={handleCloseRevertSnackbar}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
          <Alert onClose={handleCloseRevertSnackbar} severity={revertSnackbar?.severity || 'info'} sx={{ width: '100%' }}>
              {revertSnackbar?.message}
          </Alert>
      </Snackbar>

      {/* Manage Users Modal --- (Direct Update) */} 
      <Dialog open={isManageUsersModalOpen} onClose={handleCloseManageUsersModal} fullWidth maxWidth="lg">
          <DialogTitle>Manage Users</DialogTitle>
          <DialogContent sx={{ height: '60vh' }}>
              {userManagementError && <Alert severity="error" sx={{ mb: 2 }}>{userManagementError}</Alert>}
              {/* Add editing instruction */}
              <Typography variant="caption" sx={{ mb: 1, display: 'block', fontStyle: 'italic' }}>
                  Double-click a row to edit permissions or active status (admin user cannot be edited).
              </Typography>
              <Paper sx={{ height: 'calc(100% - 30px)', width: '100%' }}>
                  <DataGrid
                      rows={usersManagementData}
                      columns={userManagementColumns}
                      loading={isLoadingUsersData}
                      processRowUpdate={processRowUpdate}
                      onProcessRowUpdateError={handleProcessRowUpdateError}
                      editMode="row"
                      onRowEditStop={handleRowEditStop}
                      getRowId={(row) => row.id}
                      sx={{ border: 0 }}
                      density="compact"
                      hideFooter={usersManagementData.length <= 10}
                  />
              </Paper>
          </DialogContent>
          <DialogActions>
              <Button onClick={handleCloseManageUsersModal} disabled={isUpdatingUsers}>Cancel</Button>
              <Button
                  onClick={handleConfirmUpdateUsers}
                  disabled={Object.keys(editedUsersData).length === 0 || isUpdatingUsers}
                  variant="contained"
              >
                   {isUpdatingUsers ? <CircularProgress size={24} /> : "Update"}
              </Button>
          </DialogActions>
      </Dialog>

      {/* Manage Users Snackbar --- (NEW) */} 
      <Snackbar 
          open={manageUsersSnackbar?.open || false} 
          autoHideDuration={6000} 
          onClose={handleCloseManageUsersSnackbar}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
          <Alert onClose={handleCloseManageUsersSnackbar} severity={manageUsersSnackbar?.severity || 'info'} sx={{ width: '100%' }}>
              {manageUsersSnackbar?.message}
          </Alert>
      </Snackbar>
    </>
  );
} 