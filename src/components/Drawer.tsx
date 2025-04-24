"use client";
import React, { useState } from 'react';
import {
  Drawer, Box, List,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import { useEditorContext } from '@/contexts/EditorContext';
import { TreeItem } from '@mui/x-tree-view/TreeItem';
import { TreeView } from '@mui/x-tree-view/TreeView';

interface TreeNode {
  id: string;
  name: string;
  type: 'blob' | 'tree';
  path: string;
  children?: TreeNode[];
  sha?: string;
}

export default function FileDrawer() {
  const drawerWidth = 240;
  const { enqueueSnackbar } = useSnackbar();

  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

  const [newFileName, setNewFileName] = useState('');
  const [isLoadingAddFile, setIsLoadingAddFile] = useState(false);
  const [addFilePath, setAddFilePath] = useState<string | null>(null);
  const [addFileDialogOpen, setAddFileDialogOpen] = useState(false);

  const [newFolderName, setNewFolderName] = useState('');
  const [isLoadingAddFolder, setIsLoadingAddFolder] = useState(false);
  const [addFolderPath, setAddFolderPath] = useState<string | null>(null);
  const [addFolderDialogOpen, setAddFolderDialogOpen] = useState(false);

  const [newName, setNewName] = useState('');
  const [isLoadingRename, setIsLoadingRename] = useState(false);
  const [renameNode, setRenameNode] = useState<TreeNode | null>(null);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);

  const [nodeToDelete, setNodeToDelete] = useState<TreeNode | null>(null);
  const [isLoadingDelete, setIsLoadingDelete] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const {
    folderStructure = [],
    selectedBranch,
    loadFileContent,
    fetchFolderStructure,
    credentials,
  } = useEditorContext() || {};

  // --- Tree Event Handlers ---
  const handleNodeSelect = (event: React.SyntheticEvent, nodeId: string) => {
    // Find the node in the structure based on nodeId
    // This requires a helper function to search the tree
    const findNode = (nodes: TreeNode[], id: string): TreeNode | null => {
      for (const node of nodes) {
        if (node.id === id) return node;
        if (node.children) {
          const found = findNode(node.children, id);
          if (found) return found;
        }
      }
      return null;
    };

    const node = findNode(folderStructure, nodeId);

    if (node) {
      console.log("Node selected:", node);
      if (node.type === 'blob') {
        if (loadFileContent) {
          loadFileContent(node.path);
        }
        setSelectedFileId(node.id); // Track selected file
      } else {
        // Folder click - expand/collapse is handled by TreeView internally now
        console.log("Folder selected/toggled:", node.name);
      }
    } else {
      console.warn("Selected node not found in structure:", nodeId);
    }
  };

  // --- API Call Helper ---
  const callApi = async (
      endpoint: string,
      body: Record<string, unknown>,
      method: 'POST' | 'GET' | 'PUT' | 'DELETE' = 'POST',
      credentials: { githubToken?: string } | null,
      enqueueSnackbar: (message: string, options: { variant: 'success' | 'error' | 'warning' | 'info' }) => void
  ): Promise<{ success: boolean; data?: unknown; error?: string }> => {
    try {
      const token = credentials?.githubToken;
      if (!token) {
          enqueueSnackbar('GitHub token is missing.', { variant: 'error' });
          return { success: false, error: 'Authentication token not found.' };
      }

      const response = await fetch(endpoint, {
          method: method,
          headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
          },
          ...(method !== 'GET' && { body: JSON.stringify(body) })
      });

      const result = await response.json();

      if (!response.ok) {
          const errorMessage = result?.message ?? result?.error ?? 'An unknown API error occurred.';
          enqueueSnackbar(`API Error: ${errorMessage}`, { variant: 'error' });
          return { success: false, error: errorMessage };
      }

      return { success: true, data: result };

    } catch (error: unknown) {
      console.error(`API call to ${endpoint} failed:`, error);
      let message = 'Network error or failed to parse response.';
      if (error instanceof Error) {
          message = error.message;
      }
      enqueueSnackbar(`Error: ${message}`, { variant: 'error' });
      return { success: false, error: message };
    }
  };

  // --- Render Logic ---
  const renderTree = (nodes: TreeNode[]) => (
    nodes.map((node) => (
      // Use standard TreeItem directly
      <TreeItem
        key={node.id}       // React key
        nodeId={node.id}    // For TreeView identification
        itemId={node.id}    // Required by TreeItem
        label={node.name}   // Display name
        // onClick prop is not standard for TreeItem, selection is handled by TreeView's onNodeSelect
      >
        {/* Recursively render children */} 
        {Array.isArray(node.children) ? renderTree(node.children) : null}
      </TreeItem>
    ))
  );

  // Need state for expanded nodes for the TreeView component
  const [expanded, setExpanded] = useState<string[]>([]);

  const handleToggle = (event: React.SyntheticEvent, nodeIds: string[]) => {
    setExpanded(nodeIds);
  };

  return (
    <Drawer
      variant="permanent"
      open={true} // Assuming drawer is always open
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: drawerWidth,
          boxSizing: 'border-box',
        },
      }}
    >
      <Box sx={{ overflow: 'auto', p: 1 }}>
         {/* Replace List with TreeView */}
         <TreeView
            aria-label="file system navigator"
            defaultCollapseIcon={/* Add appropriate icon e.g., <ExpandMoreIcon /> */}
            defaultExpandIcon={/* Add appropriate icon e.g., <ChevronRightIcon /> */}
            sx={{ height: '100%', flexGrow: 1, maxWidth: 400, overflowY: 'auto' }}
            expanded={expanded} // Control expanded state
            onNodeToggle={handleToggle} // Handle expansion changes
            onNodeSelect={handleNodeSelect} // Handle node selection (file click)
          >
            {folderStructure && folderStructure.length > 0 ? (
                renderTree(folderStructure)
            ) : (
                <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary' }}>
                    Select a branch to view files.
                </Box>
            )}
         </TreeView>
      </Box>
    </Drawer>
  );
}