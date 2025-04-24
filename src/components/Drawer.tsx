"use client";
import React, { useState, useContext } from 'react';
import {
  Drawer, Box, List, ListItemButton, ListItemIcon, 
  Typography, Divider, IconButton, Menu, MenuItem, Dialog, DialogActions, 
  DialogContent, DialogContentText, DialogTitle, TextField, Button, Snackbar,
  Alert, CircularProgress, styled, useTheme
} from '@mui/material';
import { TreeView } from '@mui/x-tree-view/TreeView';
import { TreeItem, TreeItemProps } from '@mui/x-tree-view/TreeItem';
import { useSnackbar } from 'notistack';
import FolderIcon from '@mui/icons-material/Folder';
import DescriptionIcon from '@mui/icons-material/Description';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import AddIcon from '@mui/icons-material/Add';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import EditIcon from '@mui/icons-material/Edit';
import FileCopyIcon from '@mui/icons-material/FileCopy';
import PasteIcon from '@mui/icons-material/ContentPaste';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useEditorContext } from '@/app/contexts/EditorContext';

interface TreeNode {
  id: string;
  name: string;
  type: 'blob' | 'tree';
  path: string;
  children?: TreeNode[];
  sha?: string;
}

const StyledTreeItemRoot = styled(TreeItem)(({ theme }) => ({
  // Add styles if needed
}));

const StyledTreeItem = React.forwardRef(function StyledTreeItem(
  props: TreeItemProps,
  ref: React.Ref<HTMLLIElement>,
) {
  const theme = useTheme();
  const { 
    ...other 
  } = props;

  return (
    <StyledTreeItemRoot
      {...other}
      ref={ref}
    />
  );
});

export default function FileDrawer() {
  const drawerWidth = 240;
  const { enqueueSnackbar } = useSnackbar();

  const [treeVisible, setTreeVisible] = useState(true);

  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; node: TreeNode | null } | null>(null);

  const [addFileDialogOpen, setAddFileDialogOpen] = useState(false);
  const [addFilePath, setAddFilePath] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState('');
  const [isLoadingAddFile, setIsLoadingAddFile] = useState(false);

  const [addFolderDialogOpen, setAddFolderDialogOpen] = useState(false);
  const [addFolderPath, setAddFolderPath] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [isLoadingAddFolder, setIsLoadingAddFolder] = useState(false);

  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameNode, setRenameNode] = useState<TreeNode | null>(null);
  const [newName, setNewName] = useState('');
  const [isLoadingRename, setIsLoadingRename] = useState(false);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [nodeToDelete, setNodeToDelete] = useState<TreeNode | null>(null);
  const [isLoadingDelete, setIsLoadingDelete] = useState(false);

  const [clipboard, setClipboard] = useState<{ node: TreeNode, action: 'copy' } | null>(null);
  const [isLoadingPaste, setIsLoadingPaste] = useState(false);

  const {
    folderStructure = [],
    selectedBranch,
    fetchFileContent,
    isLoading: isContextLoading,
    fetchFolderStructure,
    credentials,
  } = useEditorContext() || {};

  // --- Helper Functions ---
  const getParentPath = (filePath: string): string => {
    const segments = filePath.split('/').filter(Boolean);
    segments.pop(); // Remove filename or last folder name
    return segments.join('/');
  };

  // --- Tree Event Handlers ---
  // ... existing code ...
  const handleAddFileSubmit = async () => {
    if (addFilePath !== null && newFileName && !isLoadingAddFile && selectedBranch && fetchFolderStructure) {
      setIsLoadingAddFile(true);
      const result = await callApi('/api/github/add-file', {
        branch: selectedBranch,
        path: addFilePath,
        filename: newFileName
      }, 'POST', credentials, enqueueSnackbar); // Pass creds & snackbar

      setAddFileDialogOpen(false);
       if (result.success) {
           enqueueSnackbar(`File '${newFileName}' added successfully.`, { variant: 'success' });
           fetchFolderStructure(selectedBranch); // Refresh structure
       } // Error handled by callApi
      setIsLoadingAddFile(false);
      setNewFileName('');
      setAddFilePath(null);
    }
  };
  // ... existing code ...
  const handleAddFolderSubmit = async () => {
    if (addFolderPath !== null && newFolderName && !isLoadingAddFolder && selectedBranch && fetchFolderStructure) {
      setIsLoadingAddFolder(true);
      const result = await callApi('/api/github/add-folder', {
          branch: selectedBranch,
          path: addFolderPath || '', // Root path if null
          foldername: newFolderName
      }, 'POST', credentials, enqueueSnackbar); // Pass creds & snackbar

      setAddFolderDialogOpen(false);
       if (result.success) {
           enqueueSnackbar(`Folder '${newFolderName}' added successfully.`, { variant: 'success' });
           fetchFolderStructure(selectedBranch); // Refresh structure
       } // Error handled by callApi
      setIsLoadingAddFolder(false);
      setNewFolderName('');
      setAddFolderPath(null);
    }
  };
  // ... existing code ...
  const handleRenameSubmit = async () => {
    if (renameNode && newName && newName !== renameNode.name && !isLoadingRename && selectedBranch && fetchFolderStructure) {
      setIsLoadingRename(true);
      const result = await callApi('/api/github/rename-item', {
          branch: selectedBranch,
          originalPath: renameNode.path,
          newName: newName,
      }, 'POST', credentials, enqueueSnackbar); // Pass creds & snackbar

      setRenameDialogOpen(false);
       if (result.success) {
           enqueueSnackbar(`Renamed to '${newName}' successfully.`, { variant: 'success' });
           fetchFolderStructure(selectedBranch); // Refresh structure
       } // Error handled by callApi
      setIsLoadingRename(false);
      setRenameNode(null);
      setNewName('');
    }
  };
  // ... existing code ...
  const handleDeleteConfirm = async () => {
    if (nodeToDelete && !isLoadingDelete && selectedBranch && fetchFolderStructure) {
      setIsLoadingDelete(true);
      // Use generic /item endpoint with DELETE method
      const result = await callApi('/api/github/item', { // Corrected endpoint
          branch: selectedBranch,
          path: nodeToDelete.path
      }, 'DELETE', credentials, enqueueSnackbar); // Pass creds & snackbar

      setDeleteConfirmOpen(false);
      if (result.success) {
        enqueueSnackbar(`'${nodeToDelete.name}' deleted successfully.`, { variant: 'success' });
        // If the deleted item was the currently selected file, clear the selection
        if (selectedFileId === nodeToDelete.id) {
          setSelectedFileId(null);
          // Optionally call updateSelectedFile(null, null) if context needs update
        }
        fetchFolderStructure(selectedBranch); // Refresh structure
      } // Error handled by callApi
      const deletedNodeId = nodeToDelete.id; // Capture ID before nulling
      setNodeToDelete(null);
      setIsLoadingDelete(false);

      // Optional: If the deleted node was expanded, remove it from expandedItems
      setExpandedItems(prev => prev.filter(id => id !== deletedNodeId));
    }
  };
  // ... existing code ...

  // --- Render Logic ---
  const renderTree = (nodes: TreeNode[]) => (
    nodes.map((node) => (
      <StyledTreeItem
        key={node.id}
        nodeId={node.id}
        label={node.name}
        onClick={() => handleNodeSelect(node)}
      >
        {node.children && renderTree(node.children)}
      </StyledTreeItem>
    ))
  );

  return (
    <Drawer
      variant="permanent"
      open={treeVisible}
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: drawerWidth,
          boxSizing: 'border-box',
        },
      }}
    >
      <Box sx={{ overflow: 'auto' }}>
        <List>
          {renderTree(folderStructure)}
        </List>
      </Box>
    </Drawer>
  );
}

// --- Generic API Call Helper ---
// Place this outside the component definition
const callApi = async (
    endpoint: string,
    body: Record<string, any>, // Use Record<string, any> for flexibility
    method: 'POST' | 'GET' | 'PUT' | 'DELETE' = 'POST',
    credentials: { githubToken?: string } | null, // Expecting object with optional token
    enqueueSnackbar: (message: string, options: { variant: 'success' | 'error' | 'warning' | 'info' }) => void // Snackbar function type
): Promise<{ success: boolean; data?: any; error?: string }> => {

    // Added check for credentials within the helper
    if (!credentials?.githubToken) {
        console.error('API Call Error: Missing GitHub token.');
        enqueueSnackbar('GitHub token not configured.', { variant: 'error' });
        return { success: false, error: 'Missing credentials' };
    }

    try {
        const response = await fetch(endpoint, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${credentials.githubToken}`, // Use token
            },
            // Only include body for relevant methods
            body: (method === 'POST' || method === 'PUT') ? JSON.stringify(body) : undefined,
        });

        // Attempt to parse JSON, handle cases where body might be empty (e.g., 204 No Content)
        let result: any;
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
             if (response.status !== 204) { // Don't parse if No Content
                result = await response.json();
             } else {
                result = { message: 'Operation successful (No Content)' }; // Or some default success object
             }
        } else {
            // Handle non-JSON responses if necessary, e.g., plain text error messages
            if (!response.ok) {
                result = { error: `Server returned status ${response.status}` };
            } else {
                result = { message: 'Operation successful (Non-JSON response)' }; // Or handle based on status
            }
        }

        if (!response.ok) {
            console.error(`API Error (${response.status}):`, result);
            // Use error message from response if available, otherwise generic message
            const errorMessage = result?.error || result?.message || `API request failed (${response.status})`;
            enqueueSnackbar(errorMessage, { variant: 'error' });
            return { success: false, error: errorMessage };
        }

        // Success: return data (which might be empty/message for 204)
        return { success: true, data: result };

    } catch (error) {
        console.error('API Call failed:', error);
        const message = error instanceof Error ? error.message : 'An unknown error occurred during the API call.';
        enqueueSnackbar(`Network or parsing error: ${message}`, { variant: 'error' });
        return { success: false, error: message }; // Indicate failure
    }
};