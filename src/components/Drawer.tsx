"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Drawer as MuiDrawer,
  IconButton,
  Divider,
  Box,
  useTheme,
  useMediaQuery,
  CircularProgress,
  Typography,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Select as MuiSelect,
  Snackbar,
  Alert,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  Paper,
} from '@mui/material';
import { DrawerProps as MuiDrawerProps } from '@mui/material/Drawer';
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Folder as FolderIcon,
  Description as DescriptionIcon,
} from '@mui/icons-material';
// Icons will be removed from rendering for now
// import FolderIcon from '@mui/icons-material/Folder';
// import DescriptionIcon from '@mui/icons-material/Description';
import { styled, Theme, CSSObject } from '@mui/material/styles';
// Use RichTreeView for controlled selection
import { RichTreeView } from '@mui/x-tree-view/RichTreeView';
import { TreeViewBaseItem } from '@mui/x-tree-view/models';
// Import TreeItem2 components and the hook
// import { TreeItem2, TreeItem2Props } from '@mui/x-tree-view/TreeItem2';
import { useEditorContext } from "@/contexts/EditorContext"; // Import context hook
import axios from 'axios';
import { 
  FormControl,
  InputLabel,
} from '@mui/material';
import { SelectChangeEvent } from '@mui/material/Select';
import { unstable_useTreeItem2 as useTreeItem2 } from '@mui/x-tree-view/useTreeItem2';
import { TreeItem2Content } from '@mui/x-tree-view/TreeItem2';
import clsx from 'clsx';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';

const drawerWidth = 300;
// Remove or comment out the incorrect base URL
// const API_BASE_URL = 'http://qpcs-server:3000';

// --- Interfaces ---
interface ApiTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

// TreeNode extends TreeViewBaseItem for RichTreeView
interface TreeNode extends TreeViewBaseItem {
  id: string; // Use path as unique ID
  label: string; // File/folder name
  type: 'blob' | 'tree';
  children?: TreeNode[];
  isFolder: boolean; // Explicitly track if it's a folder
}

// New interface for Upload Modal State
interface UploadModalState {
    open: boolean;
    targetNode: TreeNode | null; // Node right-clicked
    destinationPath: string;
    selectedFiles: FileList | null;
    isUploading: boolean;
    error: string | null;
    snackbar: { open: boolean, message: string, severity: "success" | "error" | "warning" | "info" } | null;
}

// --- Helper Functions ---

// Build tree structure (returns array of root nodes)
function buildTree(items: ApiTreeItem[], basePath: string): TreeNode[] {
  if (!items || items.length === 0) return [];

  // Create a virtual root to handle items directly under basePath
  const virtualRoot: TreeNode = { id: basePath, label: basePath, type: 'tree', children: [], isFolder: true };
  const map: { [path: string]: TreeNode } = { [basePath]: virtualRoot };

  // Sort items for predictable parent-first processing
  const relevantItems = items
    .filter(item => item.path !== basePath && item.path.startsWith(basePath))
    .sort((a, b) => a.path.localeCompare(b.path));

  relevantItems.forEach(item => {
    const pathSegments = item.path.split('/');
    const label = pathSegments.pop() || '';
    const parentPath = pathSegments.join('/');

    if (label) {
      const node: TreeNode = { id: item.path, label, type: item.type, children: item.type === 'tree' ? [] : undefined, isFolder: item.type === 'tree' };
      map[item.path] = node;

      const parentNode = map[parentPath];
      if (parentNode?.children) {
        parentNode.children.push(node);
      } else {
         // Use standard string concatenation to avoid potential template literal issues
         console.warn('Parent node not found or is not a directory: ' + parentPath + ' for item ' + item.path);
         // Optionally attach orphans to virtual root if they belong in the basePath?
         if(item.path.startsWith(basePath) && virtualRoot.children) {
            // virtualRoot.children.push(node); // Avoid adding orphans for now
         }
      }
    }
  });

  // Sort children at each level
  const sortChildren = (node: TreeNode) => {
    if (node.children) {
      node.children.sort((a, b) => {
        // Optional: Prioritize folders over files
        if (a.type === 'tree' && b.type === 'blob') return -1;
        if (a.type === 'blob' && b.type === 'tree') return 1;
        return a.label.localeCompare(b.label); // Then sort by label
       });
      node.children.forEach(sortChildren);
    }
  };
  sortChildren(virtualRoot);

  return virtualRoot.children || []; // Return only the children of the virtual root
}

// Find node by ID within the tree data array
function findNodeById(nodes: TreeNode[] | null, nodeId: string): TreeNode | null {
  if (!nodes) return null;
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    if (node.children) {
      const found = findNodeById(node.children, nodeId);
      if (found) return found;
    }
  }
  return null;
}

// Get all descendant IDs for a given node
function getAllDescendantIds(node: TreeNode | null): string[] {
  if (!node) return [];
  let ids: string[] = [];
  if (node.children) {
    node.children.forEach(child => {
      ids.push(child.id); // Add child ID
      ids = ids.concat(getAllDescendantIds(child)); // Recursively add grandchildren IDs
    });
  }
  return ids;
}


// --- Styled Components (Drawer) ---
const openedMixin = (theme: Theme): CSSObject => ({
  width: drawerWidth,
  transition: theme.transitions.create('width', {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.enteringScreen,
  }),
  overflowX: 'hidden',
});

const closedMixin = (theme: Theme): CSSObject => ({
  transition: theme.transitions.create(['width', 'visibility'], {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  overflowX: 'hidden',
  visibility: 'hidden',
  width: 0,
});

interface StyledDrawerProps extends MuiDrawerProps {
  open?: boolean;
}

const StyledDrawer = styled(MuiDrawer, { shouldForwardProp: (prop) => prop !== 'open' })<StyledDrawerProps>(
  ({ theme, open }) => ({
    width: drawerWidth,
    flexShrink: 0,
    whiteSpace: 'nowrap',
    boxSizing: 'border-box',
    ...(open && {
      ...openedMixin(theme),
      '& .MuiDrawer-paper': openedMixin(theme),
    }),
    ...(!open && {
      ...closedMixin(theme),
      '& .MuiDrawer-paper': closedMixin(theme),
    }),
  }),
);

// --- Main Drawer Component ---
export default function Drawer() {
  // --- State --- 
  const [open, setOpen] = useState(true);
  const [treeData, setTreeData] = useState<TreeNode[]>([]); 
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [isUnsavedChangesDialogOpen, setUnsavedChangesDialogOpen] = useState(false);
  const [pendingNavigationItem, setPendingNavigationItem] = useState<string | null>(null);
  
  // --- Copy Modal State --- 
  const [isCopyModalOpen, setCopyModalOpen] = useState(false);
  const [targetBranch, setTargetBranch] = useState('');
  const [isCopying, setIsCopying] = useState(false);
  const [copySnackbar, setCopySnackbar] = useState<{open: boolean, message: string, severity: "success" | "error" | "info" | "warning"} | null>(null);
  const [nodeToCopy, setNodeToCopy] = useState<TreeNode | null>(null);
  const [copyDestinationPath, setCopyDestinationPath] = useState<string | null>(null);

  // --- State for New Item Modal --- (NEW)
  const [isNewItemModalOpen, setIsNewItemModalOpen] = useState(false);
  const [newItemType, setNewItemType] = useState<'file' | 'folder' | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [isCreatingItem, setIsCreatingItem] = useState(false); // For loading state
  const [createItemError, setCreateItemError] = useState<string | null>(null);
  const [modalTargetPath, setModalTargetPath] = useState<string | null>(null); // <<< ADDED state for modal path
  const [createItemSnackbar, setCreateItemSnackbar] = useState<{open: boolean, message: string, severity: "success" | "error" | "info" | "warning"} | null>(null); // Snackbar for create success/error

  // --- State for Delete Confirmation Modal --- (NEW)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteItemPath, setDeleteItemPath] = useState<string | null>(null);
  const [deleteItemType, setDeleteItemType] = useState<'file' | 'folder' | null>(null);
  const [deleteCommitMessage, setDeleteCommitMessage] = useState('');
  const [isDeletingItem, setIsDeletingItem] = useState(false); // Loading state
  const [deleteError, setDeleteError] = useState<string | null>(null); // Error state for modal
  const [deleteSnackbar, setDeleteSnackbar] = useState<{open: boolean, message: string, severity: "success" | "error" | "info" | "warning"} | null>(null); // Snackbar for delete results

  // --- State for Intra-Branch Copy Modal --- (NEW)
  const [isIntraBranchCopyModalOpen, setIsIntraBranchCopyModalOpen] = useState(false);
  const [copySourcePath, setCopySourcePath] = useState<string | null>(null);
  const [copySourceType, setCopySourceType] = useState<'file' | 'folder' | null>(null);
  const [selectedDestinationFolder, setSelectedDestinationFolder] = useState<string | null>(null); // <<< Add state for tree selection
  const [copyNewName, setCopyNewName] = useState('');
  const [isCopyingIntraBranch, setIsCopyingIntraBranch] = useState(false); // Loading state
  const [intraBranchCopyError, setIntraBranchCopyError] = useState<string | null>(null); // Error state for modal
  const [intraBranchCopySnackbar, setIntraBranchCopySnackbar] = useState<{open: boolean, message: string, severity: "success" | "error" | "info" | "warning"} | null>(null); // Snackbar for copy results

  // --- State for Rename Modal --- (NEW)
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameItemPath, setRenameItemPath] = useState<string | null>(null);
  const [renameItemType, setRenameItemType] = useState<'file' | 'folder' | null>(null);
  const [renameOriginalName, setRenameOriginalName] = useState('');
  const [renameNewName, setRenameNewName] = useState('');
  const [isRenamingItem, setIsRenamingItem] = useState(false); // Loading state
  const [renameError, setRenameError] = useState<string | null>(null); // Error state for modal
  const [renameSnackbar, setRenameSnackbar] = useState<{open: boolean, message: string, severity: "success" | "error" | "info" | "warning"} | null>(null); // Snackbar for rename results

  // --- Refs --- 
  const isInitialBranchLoad = useRef(true); // Ref to track initial branch load
  const newItemNameInputRef = useRef<HTMLInputElement>(null); // <<< NEW Ref for input focus
  const deleteCommitMessageInputRef = useRef<HTMLTextAreaElement>(null); // <<< NEW Ref for delete commit input
  const renameNewNameInputRef = useRef<HTMLInputElement>(null); // <<< NEW Ref for rename input focus

  // --- Context --- 
  const context = useEditorContext();
  const {
    loadFileContent,
    selectedBranch,
    selectedUser,
    password,
    branches,
    hasUnsavedChanges,
    selectedFile,
    updateSelectedFile,
    // Get counter for branch state changes (NEW)
    branchStateCounter,
    renameItem = async (p: string, n: string) => console.warn('[CONTEXT MISSING] renameItem called:', p, n),
    deleteItem = async (p: string, m: string) => console.warn('[CONTEXT MISSING] deleteItem called:', p, m),
    addFile = async (p: string, f: string) => console.warn('[CONTEXT MISSING] addFile called:', p, f),
    addFolder = async (p: string, f: string) => console.warn('[CONTEXT MISSING] addFolder called:', p, f),
    diffWithMain,
  } = context;

  // Build a Set of changed file paths for fast lookup (any status)
  const highlightedFiles = new Set(
    (diffWithMain || [])
      .filter(entry => ['added', 'removed', 'modified', 'renamed'].includes(entry.status))
      .map(entry => entry.filename)
  );

  // --- Hooks --- 
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  // --- Refactored Tree Data Fetching --- (NEW useCallback)
  const fetchTreeData = useCallback(async (branch: string | null) => {
      if (!branch) {
          setTreeData([]);
          setLoading(false);
          setError(null);
          return;
      }
      console.log(`Fetching folder structure for branch: ${branch}`);
      setLoading(true);
      setError(null);
      try {
          // Use relative path for same-origin requests
          const url = `/api/github/folder-structure?branch=${encodeURIComponent(branch)}`;
          const response = await axios.get<ApiTreeItem[]>(url);
          // Set the basePath to the root (empty string) to show the full tree
          const basePath = ''; 
          const tree = buildTree(response.data, basePath);
          setTreeData(tree);
      } catch (err: any) {
          console.error('Error fetching folder structure:', err);
          setError(err.response?.data?.error || err.message || 'Failed to fetch directory structure');
          setTreeData([]);
      } finally {
          setLoading(false);
      }
  }, []); // No dependencies needed as it uses args or context values read later

  // Effect to fetch tree data based on context.selectedBranch
  useEffect(() => {
    // Use the refactored fetch function
    fetchTreeData(context.selectedBranch);
    // Also depends on branchStateCounter now (NEW)
  }, [context.selectedBranch, fetchTreeData, branchStateCounter]); 

  // --- EFFECT to clear selected items on branch change --- 
  useEffect(() => {
    // Don't clear on the very first branch load/mount
    if (isInitialBranchLoad.current) {
        // Check if a branch is actually selected on initial load before flipping the flag
        if (context.selectedBranch !== null) { 
             isInitialBranchLoad.current = false;
        }
        return; 
    }

    // If we reach here, it means the branch has changed *after* initial load
    console.log(`Branch changed to ${context.selectedBranch}, clearing selected items.`);
    setSelectedItems([]); // Clear the selected items

  }, [context.selectedBranch]); // Depend on selectedBranch from context

  // --- Helper Function (proceedWithNavigation) ---
  const proceedWithNavigation = useCallback((itemId: string | null) => {
    if (itemId) {
      const node = findNodeById(treeData, itemId);
      if (node && node.type === 'blob') {
        loadFileContent(itemId); // Load file from context
      }
    }
    // Reset pending navigation state
    setPendingNavigationItem(null);
  }, [treeData, loadFileContent]); // Dependencies updated

  // --- Handlers --- 
  const handleDrawerToggle = () => { setOpen(!open); };
  const handleItemClick = useCallback((event: React.SyntheticEvent, itemId: string) => {
    // Prevent click from triggering if the target is the checkbox or its SVG icon
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' && target.getAttribute('type') === 'checkbox') {
      return; // It's the checkbox input, do nothing here
    }
    if (target.closest('[data-testid="CheckBoxIcon"]') || target.closest('[data-testid="CheckBoxOutlineBlankIcon"]')) {
       return; // It's one of the checkbox icons, do nothing here
    }

    const node = findNodeById(treeData, itemId);
    // Check if it's a file ('blob') before attempting to load
    if (node && node.type === 'blob') {
      if (hasUnsavedChanges) {
        // If changes exist, open dialog and store intended navigation
        setPendingNavigationItem(itemId);
        setUnsavedChangesDialogOpen(true);
      } else {
        // No unsaved changes, navigate directly
        proceedWithNavigation(itemId);
      }
    }
    // Allow default behavior (expand/collapse) for folders
  }, [treeData, hasUnsavedChanges, proceedWithNavigation]);

  // --- Copy Modal Handlers --- 
  const handleOpenCopyModal = () => {
      setTargetBranch(''); 
      setCopySnackbar(null);
      setCopyModalOpen(true);
  };

  const handleCloseCopyModal = () => {
      setCopyModalOpen(false);
  };

  const handleTargetBranchChange = (event: SelectChangeEvent<string>) => {
      setTargetBranch(event.target.value);
  };
  
  // handleConfirmCopy uses local treeData, context auth values
  const handleConfirmCopy = async () => {
    // Validation - using context values
    if (!context.selectedBranch || !context.selectedUser || !context.password || selectedItems.length === 0) {
        setCopySnackbar({open: true, message: "Source branch, user, password, and selected files are required.", severity: "error"});
        handleCloseCopyModal();
        return;
    }
    if (context.selectedBranch === targetBranch) {
         setCopySnackbar({open: true, message: "Source and target branches cannot be the same.", severity: "error"});
         return; // Keep modal open
    }
    if (!targetBranch) { // Explicit check for empty target branch
        setCopySnackbar({open: true, message: "Target branch must be selected to proceed.", severity: "error"});
        return;
    }

    setIsCopying(true);
    handleCloseCopyModal(); 
    setCopySnackbar({ open: true, message: `Copying selected item(s)...`, severity: "info"});

    // Filter selectedItems to only include blobs (files)
    const filesToCopy = selectedItems.filter(id => {
        const node = findNodeById(treeData, id);
        return node?.type === 'blob';
    });

    if (filesToCopy.length === 0) {
         setCopySnackbar({open: true, message: "No files selected to copy. Please select one or more files.", severity: "info"});
         setIsCopying(false);
         return;
    }

    try {
        const apiResponse = await axios.post(`/api/github/copy-files`, {
            username: context.selectedUser,
            password: context.password,
            source_branch: context.selectedBranch,
            target_branch: targetBranch,
            paths: filesToCopy
        });
        
        console.log("Copy API Response:", apiResponse.data);

        // The API now provides a clear success flag and a comprehensive message.
        // A status of 207 indicates partial success (e.g., copy ok, but tagging failed).
        const isSuccess = apiResponse.data.success;
        const severity = isSuccess ? (apiResponse.status === 207 ? "warning" : "success") : "error";
        const message = apiResponse.data.message || (isSuccess ? "Operation completed successfully." : "An unknown error occurred.");

        setCopySnackbar({ open: true, message, severity });

        // On success, trigger a refresh of the tree data
        if (isSuccess) {
            console.log("Copy successful, refreshing tree data.");
            fetchTreeData(context.selectedBranch);
        }

    } catch (err: any) {
        console.error("Copy error:", err);
        const errorMsg = err.response?.data?.error || err.message || 'Unknown error';
        setCopySnackbar({open: true, message: `Copy failed: ${errorMsg}`, severity: "error"});
    } finally {
        setIsCopying(false);
    }
  };

  // --- Snackbar Close Handler --- 
  const handleCloseSnackbar = (event?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') return;
    setCopySnackbar(null);
  };

  // Unsaved Changes Dialog Handlers
  const handleCloseUnsavedDialog = () => {
    setUnsavedChangesDialogOpen(false);
    setPendingNavigationItem(null); // Clear pending navigation on close
  };

  const handleConfirmDiscardChanges = () => {
    setUnsavedChangesDialogOpen(false);
    // Proceed with the navigation that was interrupted
    proceedWithNavigation(pendingNavigationItem);
  };

  // --- Render --- 
  const drawerVariant = isMobile ? "temporary" : "permanent";
  const DrawerComponent = drawerVariant === 'permanent' ? StyledDrawer : MuiDrawer;

  // --- Context Menu State --- 
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; node: TreeNode | null } | null>(null);
  // We don't strictly need contextNodePath/Type if we store the whole node
  // const [contextNodePath, setContextNodePath] = useState<string | null>(null);
  // const [contextNodeType, setContextNodeType] = useState<'file' | 'folder' | null>(null);

  useEffect(() => {
    if (selectedBranch) {
      console.log("Drawer: Branch selected, fetching tree data for", selectedBranch);
      // fetchTreeData(selectedBranch);
    } else {
      console.log("Drawer: No branch selected, clearing tree data.");
      setTreeData([]); // Clear tree if no branch selected
    }
  }, [selectedBranch, // fetchTreeData, setTreeData
  ]);

  const handleExpandedItemsChange = (
    event: React.SyntheticEvent,
    itemIds: string[],
  ) => {
    setTreeData(prevTreeData =>
      prevTreeData.map(node =>
        itemIds.includes(node.id) ? { ...node, expanded: true } : { ...node, expanded: false }
      )
    );
  };

  const handleSelectedItemsChange = (
    event: React.SyntheticEvent,
    newItemIds: string[], // The list potentially reflecting the latest user interaction
  ) => {
    // Determine the difference between new and old selected items
    const previousSelection = new Set(selectedItems);
    const currentSelection = new Set(newItemIds);
    let changedItemId: string | null = null;

    // Find item added
    for (const id of currentSelection) {
      if (!previousSelection.has(id)) {
        changedItemId = id;
        break;
      }
    }
    // If no item added, find item removed
    if (!changedItemId) {
        for (const id of previousSelection) {
           if (!currentSelection.has(id)) {
               changedItemId = id;
               break;
           }
        }
    }

    if (!changedItemId) {
        // Should not happen if the selection actually changed, but handle defensively
        console.warn("[handleSelectedItemsChange] No change detected.");
        setSelectedItems(newItemIds); // Fallback to MUI's state
        return;
    }

    const node = findNodeById(treeData, changedItemId);
    if (!node) {
         console.warn(`[handleSelectedItemsChange] Node not found for ID: ${changedItemId}`);
         setSelectedItems(newItemIds); // Fallback
         return;
    }

    const isChecked = currentSelection.has(changedItemId);
    let finalSelection = new Set(selectedItems); // Start with previous state for modification

    if (node.isFolder) {
        const descendantIds = getAllDescendantIds(node);
        const allIdsToChange = [changedItemId, ...descendantIds];
        console.log(`[handleSelectedItemsChange] Folder '${changedItemId}' interaction. Checked: ${isChecked}. Descendants: ${descendantIds.length}`);
        
        if (isChecked) {
            // Add folder and all descendants
            allIdsToChange.forEach(id => finalSelection.add(id));
        } else {
            // Remove folder and all descendants
            allIdsToChange.forEach(id => finalSelection.delete(id));
        }
    } else {
        // It's a file, just add or remove the single item
        if (isChecked) {
             finalSelection.add(changedItemId);
        } else {
             finalSelection.delete(changedItemId);
        }
    }

    // Convert the final set back to an array for the state
    const newSelectedItemsArray = Array.from(finalSelection);
    setSelectedItems(newSelectedItemsArray);
    console.log(`[handleSelectedItemsChange] Updated selectedItems count: ${newSelectedItemsArray.length}`);

    /* // <<< REMOVE File Selection Logic from here >>>
    // Get the last selected item ID, assuming single-click selection intent
    const lastSelectedId = newItemIds.length > 0 ? newItemIds[newItemIds.length - 1] : null;
    console.log("Node selection changed. Last selected:", lastSelectedId);
    
    if (lastSelectedId) {
      const findNode = (nodes: TreeNode[], id: string): TreeNode | null => { ... };
      const selectedNode = findNode(treeData, lastSelectedId);
      if (selectedNode && !selectedNode.isFolder) { // Only update if it's a file
        updateSelectedFile(lastSelectedId);
        console.log("[Drawer] Updated selected file context:", lastSelectedId);
      } else if (selectedNode && selectedNode.isFolder) {
        console.log("Folder selected via checkbox/multi-select, not updating file context.");
      } else {
        // Clear selection if the last selected item is not found (shouldn't happen)
        updateSelectedFile(null);
      }
    } else {
      // No items selected, clear the context
      updateSelectedFile(null);
      console.log("[Drawer] Selection cleared, updated file context to null.");
    }
    
    // Update the local state for checkboxes if multiSelect/checkboxSelection is used
    // This might need different logic depending on how you want checkboxes to behave
    setSelectedItems(newItemIds);
    */
  };

  // --- Context Menu Handlers --- (Reverted to DOM inspection)
  const handleContextMenu = (event: React.MouseEvent<HTMLUListElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const targetElement = event.target as HTMLElement;
      // Find the closest TreeItem root element
      const treeItemElement = targetElement.closest('.MuiTreeItem-root'); 
      // Try to get the item ID - RichTreeView might use data-id or similar
      const itemId = treeItemElement?.getAttribute('data-id'); // Check for data-id first
                      // || treeItemElement?.getAttribute('data-path'); // Fallback if needed

      if (!itemId) {
          console.warn('[Drawer] Context menu: Could not determine node ID from target element.');
          setContextMenu(null);
          return;
      }

      const node = findNodeById(treeData, itemId);
      if (!node) {
          console.warn(`[Drawer] Context menu node not found in treeData for ID: ${itemId}`);
          setContextMenu(null);
          return;
      }

      console.log(`[Drawer] Context menu for ${node.type}: ${node.id}`);
      setContextMenu(
          contextMenu === null
              ? {
                  mouseX: event.clientX + 2,
                  mouseY: event.clientY - 6,
                  node: node, // Store the found node object
              }
              : null,
      );
  };

  const handleCloseContextMenu = () => {
    setContextMenu(null);
  };

  const handleRename = () => {
    if (contextMenu?.node) {
      const node = contextMenu.node;
      const itemTypeDisplay = node.type === 'tree' ? 'folder' : 'file';
      const currentName = node.label;
      
      // Set state for the rename modal
      setRenameItemPath(node.id);
      setRenameItemType(itemTypeDisplay);
      setRenameOriginalName(currentName);
      setRenameNewName(currentName); // Pre-fill with current name
      setRenameError(null); // Clear previous errors
      setIsRenamingItem(false); // Reset loading state

      // Open the modal
      setIsRenameModalOpen(true);
    }
    handleCloseContextMenu();
  };

  const handleDelete = () => {
    if (contextMenu?.node) {
      const node = contextMenu.node;
      const itemTypeDisplay = node.type === 'tree' ? 'folder' : 'file';
      
      // Set state for the delete confirmation modal
      setDeleteItemPath(node.id); 
      setDeleteItemType(itemTypeDisplay); // 'file' or 'folder'
      setDeleteCommitMessage(`Delete ${itemTypeDisplay} ${node.label}`); // Pre-fill commit message
      setDeleteError(null); // Clear any previous errors
      setIsDeletingItem(false); // Ensure loading state is reset

      // Open the modal
      setIsDeleteModalOpen(true);
    }
    handleCloseContextMenu();
  };

  const handleCopy = () => {
    if (contextMenu?.node) {
      const node = contextMenu.node;
      console.log(`Intra-branch copy requested for: ${node.id}`);
      
      // Set state for the INTRA-BRANCH copy modal
      setCopySourcePath(node.id);
      setCopySourceType(node.type === 'tree' ? 'folder' : 'file');

      // Suggest a default destination (parent folder) and name (original name)
      const pathSegments = node.id.split('/');
      const originalName = pathSegments.pop() || '';
      // Default to root ('') or the parent path
      const parentPath = pathSegments.join('/') || ''; 
      
      setSelectedDestinationFolder(parentPath); // Set initial selection in the tree
      setCopyNewName(originalName); // Default to original name
      
      // Reset other intra-branch modal states
      setIntraBranchCopyError(null);
      setIsCopyingIntraBranch(false);
      setIntraBranchCopySnackbar(null);

      // Open the INTRA-BRANCH modal
      setIsIntraBranchCopyModalOpen(true); 
    }
    handleCloseContextMenu();
  };

  // --- New Item Modal Handlers --- (NEW)
  const handleCloseNewItemModal = () => {
    setIsNewItemModalOpen(false);
    setNewItemName('');
    setNewItemType(null);
    setModalTargetPath(null);
    setCreateItemError(null);
    setIsCreatingItem(false);
  };

  const handleNewItemNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    // Basic validation: prevent slashes for now
    const name = event.target.value;
    if (!name.includes('/')) {
      setNewItemName(name);
    }
    setCreateItemError(null); // Clear error on type
  };

  const handleConfirmCreateItem = async () => {
    if (!newItemName || !newItemType || !modalTargetPath || !selectedBranch || !selectedUser || !password) {
      setCreateItemError('Missing required information (name, type, path, branch, user, or password).');
      return;
    }
    if (newItemName.includes('/') || newItemName.includes('\\\\')) {
        setCreateItemError('Name cannot contain slashes.');
        return;
    }

    setIsCreatingItem(true);
    setCreateItemError(null);
    setCreateItemSnackbar(null);

    // --- API Call Logic ---
    if (newItemType === 'file') {
      console.log(`Calling API to create file: ${newItemName} in folder: ${modalTargetPath} on branch ${selectedBranch}`);
      try {
        // Use relative path
        const response = await axios.post(`/api/github/add-file`, {
          username: selectedUser,
          password: password,
          branch: selectedBranch,
          path: modalTargetPath, // The folder path
          filename: newItemName   // The new file's name
        });

        console.log('API Response:', response.data);

        if (response.data.success) {
          setCreateItemSnackbar({ open: true, message: response.data.message || `File '${newItemName}' created successfully.`, severity: 'success' });
          handleCloseNewItemModal();
          await fetchTreeData(selectedBranch); // Refresh tree on success
        } else {
          // Handle cases where API returns success=false or specific errors (like tagging failure in 207)
          const message = response.data.message || `Failed to create file '${newItemName}'. ${response.data.tagError || ''}`;
          setCreateItemError(message); // Show error in modal
          setCreateItemSnackbar({ open: true, message: message, severity: response.status === 207 ? 'warning' : 'error' }); // Show snackbar error/warning
        }

      } catch (error: any) {
        console.error(`Error creating file:`, error);
        const errMsg = error.response?.data?.error || error.message || `Failed to create file '${newItemName}'.`;
        setCreateItemError(errMsg); // Show error message in the modal
        setCreateItemSnackbar({ open: true, message: errMsg, severity: 'error' }); // Show snackbar error
        // Keep modal open on error
      } finally {
        setIsCreatingItem(false);
      }
    } else if (newItemType === 'folder') {
        console.log(`Calling API to create FOLDER: ${newItemName} in path: ${modalTargetPath} on branch ${selectedBranch}`);
        try {
          // Use relative path
          const response = await axios.post(`/api/github/add-folder`, {
            username: selectedUser,
            password: password,
            branch: selectedBranch,
            path: modalTargetPath,    // The parent folder path
            foldername: newItemName // The name of the new folder
          });

          console.log('API Response:', response.data);

          if (response.data.success) {
            setCreateItemSnackbar({ open: true, message: response.data.message || `Folder '${newItemName}' created successfully.`, severity: 'success' });
            handleCloseNewItemModal();
            await fetchTreeData(selectedBranch); // Refresh tree on success
          } else {
            // Handle API errors reported in the success=false response
            const message = response.data.message || `Failed to create folder '${newItemName}'.`;
            setCreateItemError(message); // Show error in modal
            setCreateItemSnackbar({ open: true, message: message, severity: 'error' }); // Show snackbar error
          }

        } catch (error: any) {
          console.error(`Error creating folder:`, error);
          const errMsg = error.response?.data?.error || error.message || `Failed to create folder '${newItemName}'.`;
          setCreateItemError(errMsg); // Show error message in the modal
          setCreateItemSnackbar({ open: true, message: errMsg, severity: 'error' }); // Show snackbar error
          // Keep modal open on error
        } finally {
          setIsCreatingItem(false);
        }
    }
  };

  // --- Delete Item Handlers --- (NEW)
  const handleCloseDeleteModal = () => {
    setIsDeleteModalOpen(false);
    setDeleteItemPath(null);
    setDeleteItemType(null);
    setDeleteCommitMessage('');
    setDeleteError(null);
    setIsDeletingItem(false);
  };

  const handleConfirmDeleteItem = async () => {
    // Removed !deleteCommitMessage check as it's now optional
    if (!deleteItemPath || !deleteItemType /*|| !deleteCommitMessage*/ || !selectedBranch || !selectedUser || !password) {
      setDeleteError('Missing required information (path, type, branch, user, or password).');
      return;
    }
    setIsDeletingItem(true);
    setDeleteError(null);
    setDeleteSnackbar(null);

    console.log(`Calling API to delete ${deleteItemType} at path ${deleteItemPath} with message "${deleteCommitMessage}"`);

    // --- Actual API Call --- 
    try {
      // Use relative path
      const response = await axios.delete(`/api/item`, {
        // Axios DELETE requests send data in the 'data' property
        data: {
          username: selectedUser,
          password: password,
          branch: selectedBranch,
          path: deleteItemPath,
          message: deleteCommitMessage,
        },
        // Optional: Set headers if needed, though axios might handle Content-Type
        // headers: { 'Content-Type': 'application/json' }
      });

      console.log('API Response:', response.data);

      if (response.data.success) {
        setDeleteSnackbar({ open: true, message: response.data.message || `${deleteItemType === 'file' ? 'File' : 'Folder'} deleted successfully.`, severity: 'success' });
        handleCloseDeleteModal(); // Close modal on success
        await fetchTreeData(selectedBranch); // Refresh tree data
      } else {
        // Handle API errors reported in success=false response (though usually caught in catch block)
        const message = response.data.message || `Failed to delete ${deleteItemType}.`;
        setDeleteError(message); // Show error in modal
        setDeleteSnackbar({ open: true, message: message, severity: 'error' }); // Show snackbar error
      }
      
    } catch (error: any) {
       console.error(`Error deleting ${deleteItemType}:`, error);
       const errMsg = error.response?.data?.error || error.message || `Failed to delete ${deleteItemType}.`;
       setDeleteError(errMsg); // Show error in modal
       setDeleteSnackbar({ open: true, message: errMsg, severity: 'error' }); // Show snackbar error
       // Keep modal open
    } finally {
       setIsDeletingItem(false);
    }
    // --- End API Call ---
  };

  // --- Effect to focus input when New Item Modal opens --- (NEW)
  useEffect(() => {
    if (isNewItemModalOpen) {
      // Timeout needed to allow the dialog transition and rendering to complete
      const timer = setTimeout(() => {
        newItemNameInputRef.current?.focus();
      }, 100); // Small delay (adjust if needed)
      return () => clearTimeout(timer); // Cleanup timer on unmount or state change
    }
  }, [isNewItemModalOpen]);

  // --- Effect to focus input when Delete Modal opens --- (NEW)
  useEffect(() => {
    if (isDeleteModalOpen) {
      const timer = setTimeout(() => {
        deleteCommitMessageInputRef.current?.focus();
      }, 100); 
      return () => clearTimeout(timer);
    }
  }, [isDeleteModalOpen]);

  // --- Intra-Branch Copy Item Handlers --- (NEW)
  const handleCloseIntraBranchCopyModal = () => {
    setIsIntraBranchCopyModalOpen(false);
    setCopySourcePath(null);
    setCopySourceType(null);
    setSelectedDestinationFolder(null);
    setCopyNewName('');
    setIntraBranchCopyError(null);
    setIsCopyingIntraBranch(false);
  };

  const handleConfirmIntraBranchCopy = async () => {
    if (!copySourcePath || !copySourceType || !selectedDestinationFolder || !copyNewName || !selectedBranch || !selectedUser || !password) { 
      setIntraBranchCopyError('Missing required information (source, type, destination folder, name, branch, user, or password).');
      return;
    }
    // Basic validation
    if (copyNewName.includes('/') || copyNewName.includes('\\')) {
      setIntraBranchCopyError('New name cannot contain slashes.');
      return;
    }
    
    setIsCopyingIntraBranch(true);
    setIntraBranchCopyError(null);
    setIntraBranchCopySnackbar(null);

    console.log(`Calling API to copy ${copySourceType} from ${copySourcePath} to ${selectedDestinationFolder}/${copyNewName}`);

    // --- Actual API Call --- 
    try {
       // Use relative path
       const response = await axios.post(`/api/github/copy-item-intra-branch`, {
          username: selectedUser,
          password: password,
          branch: selectedBranch,
          sourcePath: copySourcePath,
          destinationPath: selectedDestinationFolder, 
          newName: copyNewName,
       });

      console.log('API Response:', response.data);

      // Check for success (200 or 207)
      if ((response.status === 200 || response.status === 207) && response.data.success) {
        setIntraBranchCopySnackbar({
           open: true, 
           message: response.data.message || `${copySourceType === 'file' ? 'File' : 'Folder'} copied successfully.`, 
           severity: response.status === 207 ? 'warning' : 'success' 
        });
        handleCloseIntraBranchCopyModal(); // Close modal on success
        await fetchTreeData(selectedBranch); // Refresh tree data
      } else {
        // Handle unexpected success=false cases
         throw new Error(response.data.message || `Copy operation failed with status ${response.status}`);
      }
      
    } catch (error: any) {
       console.error(`Error copying ${copySourceType}:`, error);
       const errMsg = error.response?.data?.error || error.message || `Failed to copy ${copySourceType}.`;
       setIntraBranchCopyError(errMsg); // Show error in modal
       setIntraBranchCopySnackbar({ open: true, message: errMsg, severity: 'error' }); // Show snackbar error
       // Keep modal open
    } finally {
       setIsCopyingIntraBranch(false);
    }
    // --- End API Call ---

  };

  // Recursive function to filter tree data for folders only
  function filterFolders(nodes: TreeNode[]): TreeNode[] {
    return nodes
      .filter(node => node.isFolder)
      .map(node => ({
        ...node,
        children: node.children ? filterFolders(node.children) : undefined,
      }));
  }

  // --- Rename Item Handlers --- (NEW)
  const handleCloseRenameModal = () => {
    setIsRenameModalOpen(false);
    setRenameItemPath(null);
    setRenameItemType(null);
    setRenameOriginalName('');
    setRenameNewName('');
    setRenameError(null);
    setIsRenamingItem(false);
  };

  const handleConfirmRename = async () => {
    if (!renameItemPath || !renameItemType || !renameNewName || !renameOriginalName || !selectedBranch || !selectedUser || !password) {
      setRenameError('Missing required information.');
      return;
    }
    // Basic validation (already handled by button disable, but good practice)
    if (renameNewName === renameOriginalName || renameNewName.includes('/') || renameNewName.includes('\\') || !renameNewName) {
        setRenameError('Invalid new name provided.'); // Should not happen if button logic is correct
        return;
    }
    
    setIsRenamingItem(true);
    setRenameError(null);
    setRenameSnackbar(null);

    const parentPath = renameItemPath.substring(0, renameItemPath.lastIndexOf('/'));
    const proposedNewPath = `${parentPath}/${renameNewName}`;

    console.log(`Calling API to rename ${renameItemType} from ${renameItemPath} to ${proposedNewPath}`);

    // --- Actual API Call --- 
    try {
      // Use relative path
      const response = await axios.post(`/api/github/rename-item`, {
         username: selectedUser,
         password: password,
         branch: selectedBranch,
         originalPath: renameItemPath, 
         newName: renameNewName,
      });
      
      console.log('API Response:', response.data);

      // Check for success (200 or 207)
      if ((response.status === 200 || response.status === 207) && response.data.success) {
        setRenameSnackbar({ 
            open: true, 
            message: response.data.message || `${renameItemType === 'file' ? 'File' : 'Folder'} renamed successfully.`, 
            severity: response.status === 207 ? 'warning' : 'success' 
        });
        await fetchTreeData(selectedBranch); // Refresh tree
        handleCloseRenameModal(); // Close modal
      } else {
         // Handle unexpected success=false cases
         throw new Error(response.data.message || `Rename operation failed with status ${response.status}`);
      }

    } catch (error: any) {
       console.error(`Error renaming ${renameItemType}:`, error);
       const errMsg = error.response?.data?.error || error.message || `Failed to rename ${renameItemType}.`;
       setRenameError(errMsg); // Show error in modal
       setRenameSnackbar({ open: true, message: errMsg, severity: 'error' }); // Show snackbar error
    } finally {
       setIsRenamingItem(false);
    }
    // --- End API Call ---
  };

  // --- Effect to focus input when Rename Modal opens --- (NEW)
  useEffect(() => {
    if (isRenameModalOpen) {
      const timer = setTimeout(() => {
        renameNewNameInputRef.current?.focus();
        renameNewNameInputRef.current?.select(); // Select text for easy replacement
      }, 100); 
      return () => clearTimeout(timer);
    }
  }, [isRenameModalOpen]);

  // --- State for Upload Modal --- (NEW)
  const [uploadModalState, setUploadModalState] = useState<UploadModalState>({
      open: false,
      targetNode: null,
      destinationPath: "",
      selectedFiles: null,
      isUploading: false,
      error: null,
      snackbar: null
  });

  // --- Upload Modal Handlers --- (Modify for tree selection)
  const handleOpenUploadModal = () => {
    if (contextMenu?.node) {
        const node = contextMenu.node;
        let destPath = "";
        // Correct type check: 'tree' for folders
        if (node.type === 'tree') {
            destPath = node.id; 
        } else {
            destPath = node.id.substring(0, node.id.lastIndexOf('/')); 
        }
        
        console.log(`Upload Modal Opened. Target Node: ${node.id}, Deduced Destination: ${destPath}`);

        setUploadModalState({
            open: true,
            targetNode: node,
            destinationPath: destPath, // Initial destination path
            selectedFiles: null, 
            isUploading: false,
            error: null,
            snackbar: null,
        });
    }
    handleCloseContextMenu();
  };

  const handleUploadDestinationChange = (event: React.SyntheticEvent, itemId: string | null) => {
    // Update destination path based on tree selection
    const newDestPath = typeof itemId === 'string' ? itemId : '' // Use root if null/cleared
    setUploadModalState(prev => ({ ...prev, destinationPath: newDestPath, error: null }));
    console.log("Upload destination changed:", newDestPath);
  };

  const handleCloseUploadModal = () => {
      setUploadModalState(prev => ({ ...prev, open: false }));
  };

  const handleFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.target.files) {
          console.log("Files selected:", event.target.files);
          setUploadModalState(prev => ({ ...prev, selectedFiles: event.target.files, error: null }));
      }
  };

  // Updated Upload Logic (Replacing Stub)
  const handleConfirmUpload = async () => {
      const { destinationPath, selectedFiles } = uploadModalState;

      if (!selectedBranch || !selectedUser || !password) {
          setUploadModalState(prev => ({ ...prev, error: "User, password, and branch selection are required.", snackbar: null }));
          return;
      }
      if (!destinationPath && destinationPath !== '') { // Allow uploading to root ('')
          setUploadModalState(prev => ({ ...prev, error: "Please select a destination folder.", snackbar: null }));
          return;
      }
      if (!selectedFiles || selectedFiles.length === 0) {
          setUploadModalState(prev => ({ ...prev, error: "No files selected for upload.", snackbar: null }));
          return;
      }
      
      setUploadModalState(prev => ({ ...prev, isUploading: true, error: null, snackbar: null }));
      console.log(`--- Starting Upload Process ---`);
      console.log(` User: ${selectedUser}`);
      console.log(` Branch: ${selectedBranch}`);
      console.log(` Destination Path: ${destinationPath || '/'}`);
      console.log(` Files: ${selectedFiles.length}`);

      try {
          // 1. Read and Encode files
          const filePromises = Array.from(selectedFiles).map(file => {
              return new Promise<{ name: string, content: string }>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = (event) => {
                      if (event.target && typeof event.target.result === 'string') {
                           const base64Content = event.target.result.split(',')[1];
                           if (base64Content) {
                              // @ts-ignore - file.name exists
                              resolve({ name: file.name, content: base64Content });
                           } else {
                              // @ts-ignore
                              reject(new Error(`Failed to read base64 content for file: ${file.name}`));
                           }
                      } else {
                          // @ts-ignore
                          reject(new Error(`Failed to read file: ${file.name}`));
                      }
                  };
                  reader.onerror = (error) => {
                       // @ts-ignore
                      reject(new Error(`Error reading file ${file.name}: ${error}`));
                  };
                  reader.readAsDataURL(file); // Read as Data URL to get base64
              });
          });

          const encodedFiles = await Promise.all(filePromises);
          console.log("All files read and encoded.");

          // 2. Prepare Payload
          const payload = {
              username: selectedUser,
              password: password,
              branch: selectedBranch,
              targetDirectory: destinationPath, // Send the selected path
              files: encodedFiles,
          };

          // 3. Make API Call
          console.log("Sending payload to /api/github/upload-files");
          // Use relative path
          const response = await axios.post(`/api/github/upload-files`, payload);

          // 4. Handle Response
          console.log("Backend Response Status:", response.status);
          console.log("Backend Response Data:", response.data);

          const responseData = response.data;
          const snackSeverity = response.status === 207 ? 'warning' : (responseData.success ? 'success' : 'error');
          
          setUploadModalState(prev => ({ 
              ...prev, 
              isUploading: false, 
              snackbar: { 
                  open: true, 
                  message: responseData.message || "Upload process finished.", 
                  severity: snackSeverity 
              },
              open: response.status !== 200, 
              selectedFiles: null, 
          }));

          // 5. Refresh Tree on Success or Partial Success
          if (response.status === 200 || response.status === 207) {
              console.log("Upload finished, refreshing tree data...");
              fetchTreeData(selectedBranch); 
          }

      } catch (err: any) {
          console.error("Upload error:", err);
          const errorMsg = err.response?.data?.error || err.message || "An unknown error occurred during upload.";
          setUploadModalState(prev => ({ 
              ...prev, 
              isUploading: false, 
              error: `Upload Failed: ${errorMsg}`, 
              snackbar: { open: true, message: `Error: ${errorMsg}`, severity: "error" } 
          }));
      } 
  };

  const handleCloseUploadSnackbar = (event?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') return;
    setUploadModalState(prev => ({ ...prev, snackbar: null }));
  };
  // --- End Upload Handlers ---

  // --- ADD handleAddFile and handleAddFolder --- (NEW)
  const handleAddFile = () => {
    if (contextMenu?.node && contextMenu.node.type === 'tree') {
      const node = contextMenu.node;
      console.log(`Action: Create NEW FILE in folder: ${node.id}`);
      setModalTargetPath(node.id); 
      setNewItemType('file');
      setNewItemName('');
      setCreateItemError(null);
      setIsNewItemModalOpen(true);
    }
    handleCloseContextMenu();
  };

  const handleAddFolder = () => {
    if (contextMenu?.node && contextMenu.node.type === 'tree') {
      const node = contextMenu.node;
      console.log(`Action: Create NEW FOLDER in folder: ${node.id}`);
      setModalTargetPath(node.id); 
      setNewItemType('folder');
      setNewItemName('');
      setCreateItemError(null);
      setIsNewItemModalOpen(true);
    }
    handleCloseContextMenu();
  };

  // Get the first root node id for yellow styling
  const firstRootId = treeData[0]?.id;

  // Helper to check if a folder contains any highlighted file
  function folderContainsHighlightedFile(node: TreeNode): boolean {
    if (!node.isFolder) return false;
    if (!node.children) return false;
    for (const child of node.children) {
      if (highlightedFiles.has(child.id)) return true;
      if (child.isFolder && folderContainsHighlightedFile(child)) return true;
    }
    return false;
  }

  return (
    <>
      {/* Revert IconButton Style */}
      <IconButton 
        onClick={handleDrawerToggle} 
        sx={{ 
            // Simple positioning, no fixed, no background
            position: 'absolute', // Or adjust based on original desired behavior
            top: theme.spacing(1), 
            left: open ? drawerWidth - 40 : 10, // Adjust positioning logic as needed
            zIndex: theme.zIndex.drawer + 1, // Ensure it's above the drawer
            transition: theme.transitions.create(['left'], { // Only transition left
               easing: theme.transitions.easing.sharp,
               duration: theme.transitions.duration.enteringScreen,
            }), // <<< ADDED COMMA HERE
        }}
      >
        {open ? <ChevronLeftIcon /> : <ChevronRightIcon />}
      </IconButton>

      {/* Drawer */}
      <DrawerComponent
        variant={drawerVariant}
        open={open}
        onClose={isMobile ? handleDrawerToggle : undefined}
        ModalProps={{ keepMounted: true }}
        sx={drawerVariant === 'temporary' ? {
          width: drawerWidth,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            boxSizing: 'border-box',
          },
        } : undefined}
      >
        {/* Restore original spacer for AppBar */}
        <Box sx={{ height: theme.spacing(8) }} /> 
        <Divider />
        
        {/* This Box now contains both TreeView and Button */}
        <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, overflow: 'hidden' }}>
          {/* Tree View Area */} 
          <Box sx={{ flexGrow: 1, overflowY: 'auto', overflowX: 'hidden', p: 1 }}>
              {/* Conditional Rendering based on branch selection and loading state */} 
              {!selectedBranch ? (
                 <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', p: 2 }}><Typography color="textSecondary" textAlign="center">Please select a branch to view files.</Typography></Box>
              ) : loading ? (
                 <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}><CircularProgress /></Box>
              ) : error ? (
                 <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', p: 2 }}><Typography color="error" textAlign="center">Error: {error}</Typography></Box>
              ) : treeData.length === 0 ? (
                 <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', p: 2 }}><Typography color="textSecondary" textAlign="center">No files found for this branch.</Typography></Box>
              ) : (
                <RichTreeView
                  items={treeData}
                  multiSelect
                  checkboxSelection
                  selectedItems={selectedItems} 
                  onSelectedItemsChange={handleSelectedItemsChange}
                  onItemClick={handleItemClick}
                  onContextMenu={handleContextMenu}
                  slotProps={{
                    item: (ownerState) => {
                      // Find the node in treeData by id
                      const node = findNodeById(treeData, ownerState.itemId);
                      const isHighlighted = highlightedFiles.has(ownerState.itemId) || (node && node.isFolder && folderContainsHighlightedFile(node));
                      return {
                        'data-id': ownerState.itemId,
                        style: isHighlighted ? { color: 'yellow' } : undefined,
                      } as any;
                    },
                  }}
                  sx={{
                    flexGrow: 1, 
                    overflowX: 'hidden', 
                    width: '100%',
                  }}
                />
              )}
          </Box>
          {/* Button Area */} 
          {open && selectedBranch && treeData.length > 0 && (
                 <Box sx={{ p: 1, borderTop: `1px solid ${theme.palette.divider}` }}>
                     <Button 
                        variant="outlined" 
                        fullWidth 
                        onClick={handleOpenCopyModal}
                        disabled={selectedItems.length === 0 || isCopying} // Disable if no items checked or copying
                     >
                         {isCopying ? <CircularProgress size={24} /> : `Copy ${selectedItems.length} item(s) to branch...`}
                     </Button>
                 </Box>
          )}
        </Box>
      </DrawerComponent>

      {/* --- Copy Files Modal --- */}
      <Dialog open={isCopyModalOpen} onClose={handleCloseCopyModal}>
          <DialogTitle>Copy Files to Branch</DialogTitle>
          <DialogContent sx={{ minWidth: '400px' }}>
              <DialogContentText sx={{ mb: 2 }}>
                  Source Branch: <strong>{selectedBranch || 'N/A'}</strong>
              </DialogContentText>
              <FormControl fullWidth>
                  <InputLabel id="target-branch-label">Target Branch</InputLabel>
                  <MuiSelect
                      labelId="target-branch-label"
                      id="target-branch-select"
                      value={targetBranch}
                      label="Target Branch"
                      onChange={handleTargetBranchChange}
                      disabled={branches.length === 0 || isCopying} 
                  >
                       {branches.filter(b => b.name !== selectedBranch).map((branch) => (
                          <MenuItem key={branch.name} value={branch.name}>{branch.name}</MenuItem>
                       ))}
                  </MuiSelect>
              </FormControl>
          </DialogContent>
          <DialogActions>
              <Button onClick={handleCloseCopyModal} disabled={isCopying}>Cancel</Button>
              <Button 
                  onClick={handleConfirmCopy} 
                  disabled={isCopying || targetBranch === selectedBranch} // Keep same-branch check
                  variant="contained"
              >
                   {isCopying ? <CircularProgress size={24}/> : "Copy"}
              </Button>
          </DialogActions>
      </Dialog>

      {/* --- Snackbar for Copy Status --- */} 
      <Snackbar 
         open={copySnackbar?.open || false} 
         autoHideDuration={6000} 
         onClose={handleCloseSnackbar}
         anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
         <Alert onClose={handleCloseSnackbar} severity={copySnackbar?.severity || 'info'} sx={{ width: '100%' }}>
           {copySnackbar?.message}
         </Alert>
      </Snackbar>

      {/* --- Snackbar for Create Item results --- (NEW) */}
      <Snackbar
         open={createItemSnackbar?.open || false}
         autoHideDuration={6000}
         onClose={() => setCreateItemSnackbar(null)} // Simple close handler
         anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
         <Alert onClose={() => setCreateItemSnackbar(null)} severity={createItemSnackbar?.severity || 'info'} sx={{ width: '100%' }}>
           {createItemSnackbar?.message}
         </Alert>
      </Snackbar>

      {/* Unsaved Changes Confirmation Dialog */}
      <Dialog
        open={isUnsavedChangesDialogOpen}
        onClose={handleCloseUnsavedDialog}
        aria-labelledby="unsaved-changes-dialog-title"
        aria-describedby="unsaved-changes-dialog-description"
      >
        <DialogTitle id="unsaved-changes-dialog-title">
          Discard Unsaved Changes?
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="unsaved-changes-dialog-description">
            You have unsaved changes in the current file. Are you sure you want to discard them and open a different file?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseUnsavedDialog}>Cancel</Button>
          <Button onClick={handleConfirmDiscardChanges} color="warning"> 
            Discard Changes
          </Button>
        </DialogActions>
      </Dialog>

      {/* Context Menu */}
      <Menu
        open={contextMenu !== null}
        onClose={handleCloseContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={ contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined }
        onContextMenu={(e) => e.preventDefault()} 
      >
         <MenuItem onClick={handleRename} disabled={!contextMenu?.node}>Rename...</MenuItem>
         <MenuItem onClick={handleCopy} disabled={!contextMenu?.node}>Copy...</MenuItem>
         {contextMenu?.node?.type === 'tree' && [
              <MenuItem key="add-file" onClick={handleAddFile}>New File...</MenuItem>,
              <MenuItem key="add-folder" onClick={handleAddFolder}>New Folder...</MenuItem>
         ]}
         <MenuItem onClick={handleOpenUploadModal} disabled={!contextMenu?.node}>Upload...</MenuItem> 
         <Divider />
         <MenuItem onClick={handleDelete} sx={{ color: 'error.main' }} disabled={!contextMenu?.node}>Delete</MenuItem>
      </Menu>

      {/* --- New Item Creation Modal --- (NEW) */}
      <Dialog open={isNewItemModalOpen} onClose={handleCloseNewItemModal} maxWidth="xs" fullWidth>
        <DialogTitle>Create New {newItemType === 'file' ? 'File' : 'Folder'}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Enter the name for the new {newItemType === 'file' ? 'file' : 'folder'} within the folder:
            <br />
            <strong>{modalTargetPath}</strong>
          </DialogContentText>
          <TextField
            inputRef={newItemNameInputRef} // <<< Attach the ref here
            margin="dense"
            id="newItemName"
            label={newItemType === 'file' ? "File Name" : "Folder Name"}
            type="text"
            fullWidth
            variant="outlined"
            value={newItemName}
            onChange={handleNewItemNameChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (!isCreatingItem && newItemName && !newItemName.includes('/') && !newItemName.includes('\\')) {
                  handleConfirmCreateItem();
                }
              }
            }}
            error={!!createItemError || newItemName.includes('/') || newItemName.includes('\\')}
            helperText={createItemError || ((newItemName.includes('/') || newItemName.includes('\\')) ? "Names cannot contain slashes." : "")}
            disabled={isCreatingItem}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseNewItemModal} disabled={isCreatingItem}>Cancel</Button>
          <Button 
            onClick={handleConfirmCreateItem}
            variant="contained" 
            disabled={isCreatingItem || !newItemName || newItemName.includes('/') || newItemName.includes('\\')}
          >
            {isCreatingItem ? <CircularProgress size={24} /> : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* --- Delete Confirmation Modal --- (NEW) */}
      <Dialog open={isDeleteModalOpen} onClose={handleCloseDeleteModal} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ color: 'error.main' }}>Confirm Deletion</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Are you sure you want to delete the following {deleteItemType}?
            <br />
            <strong>{deleteItemPath}</strong>
          </DialogContentText>
          <TextField
            inputRef={deleteCommitMessageInputRef} // <<< Attach ref
            margin="dense"
            id="deleteCommitMessage"
            label="Commit Message"
            type="text"
            fullWidth
            variant="outlined"
            value={deleteCommitMessage}
            onChange={(e) => {
                setDeleteCommitMessage(e.target.value);
                if (deleteError) setDeleteError(null); // Clear error on type
            }}
            onKeyDown={(e) => { // <<< Add onKeyDown handler
                // Submit on Enter unless Shift is also pressed (for multiline)
                if (e.key === 'Enter' && !e.shiftKey) { 
                  e.preventDefault(); // Prevent newline
                  // Allow submit even if message is empty now
                  if (!isDeletingItem) {
                    handleConfirmDeleteItem();
                  }
                }
              }}
            multiline // Allow multiline messages
            rows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDeleteModal} disabled={isDeletingItem}>Cancel</Button>
          <Button 
            onClick={handleConfirmDeleteItem} 
            color="error" 
            variant="contained" 
            disabled={isDeletingItem} // Only disable while deleting
          >
            {isDeletingItem ? <CircularProgress size={24} /> : `Delete ${deleteItemType}`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* --- Snackbar for Delete Status --- (NEW) */}
      <Snackbar 
         open={deleteSnackbar?.open || false} 
         autoHideDuration={6000} 
         onClose={() => setDeleteSnackbar(null)} // Simple close handler
         anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
         <Alert onClose={() => setDeleteSnackbar(null)} severity={deleteSnackbar?.severity || 'info'} sx={{ width: '100%' }}>
           {deleteSnackbar?.message}
         </Alert>
      </Snackbar>

      {/* --- Intra-Branch Copy Modal --- (Fix Tree Selection) */}
      <Dialog open={isIntraBranchCopyModalOpen} onClose={handleCloseIntraBranchCopyModal} maxWidth="sm" fullWidth>
        <DialogTitle>Copy Item within Branch: {selectedBranch}</DialogTitle>
        <DialogContent>
           {(() => { // Use IIFE to calculate derived state
               const isConflict = selectedDestinationFolder && copyNewName && `${selectedDestinationFolder}/${copyNewName}` === copySourcePath;
               const finalError = intraBranchCopyError || (isConflict ? 'New name in the selected destination conflicts with the source path.' : null);

               return (
                  <>
                     <DialogContentText sx={{ mb: 1 }}>
                        Copying {copySourceType}: <br /><strong>{copySourcePath}</strong>
                     </DialogContentText>

                     <Typography variant="subtitle1" sx={{ mt: 2, mb: 1 }}>Select Destination Folder:</Typography>
                     <Box sx={{
                         border: '1px solid', 
                         borderColor: theme.palette.divider,
                         borderRadius: theme.shape.borderRadius,
                         height: '250px', // Adjust height as needed
                         overflow: 'auto',
                         mb: 2, // Margin below the tree
                     }}>
                        <RichTreeView
                           items={filterFolders(treeData)} 
                           selectedItems={selectedDestinationFolder || undefined}
                           multiSelect={false}
                           onSelectedItemsChange={(event, itemId) => {
                              const newSelection = Array.isArray(itemId) ? itemId[0] : itemId as string | null;
                              setSelectedDestinationFolder(newSelection || null);
                              if (intraBranchCopyError) setIntraBranchCopyError(null); 
                           }}
                           sx={{ flexGrow: 1, width: '100%' }}
                        />
                     </Box>
                     {/* Display error specifically related to destination selection */} 
                     {finalError?.includes('destination folder') && (
                        <Typography variant="caption" color="error" sx={{mb: 2}}>{finalError}</Typography>
                     )}

                     <TextField
                        required
                        margin="dense"
                        id="copyNewName"
                        label="New Name"
                        type="text"
                        fullWidth
                        variant="outlined"
                        value={copyNewName}
                        onChange={(e) => {
                           setCopyNewName(e.target.value);
                           if (intraBranchCopyError) setIntraBranchCopyError(null); 
                        }}
                        onKeyDown={(e) => {
                           if (e.key === 'Enter') {
                              e.preventDefault();
                              // Check validity including conflict
                              const isValid = !isCopyingIntraBranch && selectedDestinationFolder && copyNewName && 
                                             !copyNewName.includes('/') && !copyNewName.includes('\\') && !isConflict;
                              if (isValid) {
                                 handleConfirmIntraBranchCopy();
                              }
                           }
                        }}
                        error={!!finalError} // Use combined error state
                        helperText={finalError || "Enter the name for the copied item."}
                        disabled={isCopyingIntraBranch}
                     />

                     <Typography variant="body2" sx={{ mt: 2, mb: 1, wordBreak: 'break-all' }}>
                        Destination: {/* Changed label from Full Destination */} 
                        {selectedDestinationFolder !== null 
                          ? `${selectedDestinationFolder}${selectedDestinationFolder === '' ? '' : '/'}${copyNewName || '...'}` 
                          : '(Select folder above)'
                        }
                     </Typography>
                  </>
               );
           })()}
        </DialogContent>
        <DialogActions>
           <Button onClick={handleCloseIntraBranchCopyModal} disabled={isCopyingIntraBranch}>Cancel</Button>
           <Button 
             onClick={handleConfirmIntraBranchCopy} 
             variant="contained" 
             // Update disabled check to include conflict
             disabled={isCopyingIntraBranch || !selectedDestinationFolder || !copyNewName || copyNewName.includes('/') || copyNewName.includes('\\') || (`${selectedDestinationFolder}/${copyNewName}` === copySourcePath)}
           >
             {isCopyingIntraBranch ? <CircularProgress size={24} /> : "Copy"}
           </Button>
        </DialogActions>
      </Dialog>

      {/* --- Snackbar for Intra-Branch Copy Status --- (NEW) */}
      <Snackbar 
         open={intraBranchCopySnackbar?.open || false} 
         autoHideDuration={6000} 
         onClose={() => setIntraBranchCopySnackbar(null)} // Simple close handler
         anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
         <Alert onClose={() => setIntraBranchCopySnackbar(null)} severity={intraBranchCopySnackbar?.severity || 'info'} sx={{ width: '100%' }}>
           {intraBranchCopySnackbar?.message}
         </Alert>
      </Snackbar>

      {/* --- Rename Modal --- (NEW) */}
      <Dialog open={isRenameModalOpen} onClose={handleCloseRenameModal} maxWidth="sm" fullWidth>
        <DialogTitle>Rename {renameItemType}</DialogTitle>
        <DialogContent>
          {(() => { // IIFE for derived state
              const isSameName = renameNewName === renameOriginalName;
              const containsSlash = renameNewName.includes('/') || renameNewName.includes('\\');
              const isEmpty = !renameNewName.trim();
              const isInvalid = isEmpty || containsSlash;
              const showConflictWarning = !isInvalid && isSameName;
              const finalHelperText = renameError || 
                                    (isEmpty ? 'Name cannot be empty.' : null) ||
                                    (containsSlash ? 'Name cannot contain slashes.' : null) ||
                                    (showConflictWarning ? 'Please enter a different name.' : null) ||
                                    'Enter the new name.';
              const hasError = !!renameError || isInvalid;
              const canSubmit = !isInvalid && !isSameName && !isRenamingItem;

              // Get path without the original name
              const displayPath = renameItemPath?.substring(0, renameItemPath.lastIndexOf('/') + 1) || '';

              return (
                  <>
                     <DialogContentText sx={{ mb: 1, wordBreak: 'break-all' }}>
                       Renaming item in folder: <strong>{displayPath}</strong>
                       <br />
                       Original name: <strong>{renameOriginalName}</strong>
                     </DialogContentText>

                     <TextField
                       required
                       // autoFocus // Use useEffect instead
                       inputRef={renameNewNameInputRef} // Attach ref
                       margin="dense"
                       id="renameNewName"
                       label="New Name"
                       type="text"
                       fullWidth
                       variant="outlined"
                       value={renameNewName}
                       onChange={(e) => {
                         setRenameNewName(e.target.value);
                         if (renameError) setRenameError(null); // Clear API error on change
                       }}
                       onKeyDown={(e) => {
                         if (e.key === 'Enter' && canSubmit) {
                           e.preventDefault();
                           handleConfirmRename();
                         }
                       }}
                       error={hasError}
                       helperText={finalHelperText}
                       disabled={isRenamingItem}
                     />
                  </>
               );
            })()}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseRenameModal} disabled={isRenamingItem}>Cancel</Button>
          <Button 
            onClick={handleConfirmRename} 
            variant="contained" 
            // Disable if invalid, same name, or renaming is in progress
            disabled={!renameNewName || renameNewName === renameOriginalName || renameNewName.includes('/') || renameNewName.includes('\\') || isRenamingItem}
          >
            {isRenamingItem ? <CircularProgress size={24} /> : "Rename"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* --- Upload Modal (Updated Destination Display) */} 
      <Dialog open={uploadModalState.open} onClose={handleCloseUploadModal} maxWidth="sm" fullWidth>
          <DialogTitle>Upload Files</DialogTitle> 
          <DialogContent>
              {uploadModalState.error && <Alert severity="error" sx={{ mb: 2 }}>{uploadModalState.error}</Alert>}
              
              {/* --- Destination Folder Display (Simplified) --- */}
              <Typography variant="subtitle1" sx={{ mt: 1, mb: 0.5 }}>
                  Destination Folder:
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', mb: 2, wordBreak: 'break-all' }}>
                   {uploadModalState.destinationPath || '/'} {/* Display full path or root */} 
              </Typography>
              
              {/* --- Destination Folder Tree --- */}
              <Typography variant="caption" sx={{ mb: 0.5, display: 'block', fontStyle: 'italic'}}>
                  (Select a folder below to change destination)
              </Typography>
              <Box sx={{
                  border: '1px solid',
                  borderColor: theme.palette.divider,
                  borderRadius: theme.shape.borderRadius,
                  height: '200px', 
                  overflow: 'auto',
                  mb: 2, 
              }}>
                 <RichTreeView
                    items={filterFolders(treeData)} // Show only folders
                    selectedItems={uploadModalState.destinationPath || undefined} // Control selection
                    multiSelect={false}
                    onSelectedItemsChange={handleUploadDestinationChange} // Update state on change
                    sx={{ flexGrow: 1, width: '100%' }}
                 />
              </Box>

              {/* --- File Input Button --- */}
              <Button
                  variant="contained"
                  component="label" 
                  startIcon={<CloudUploadIcon />}
                  sx={{ mb: 2 }}
                  disabled={uploadModalState.isUploading}
              >
                  Select Files {/* Changed back */} 
                  <input
                      type="file"
                      hidden
                      multiple // Keep multiple files allowed
                      onChange={handleFileSelection}
                  />
              </Button>

              {/* --- Display Selected Files --- */} 
              {uploadModalState.selectedFiles && uploadModalState.selectedFiles.length > 0 && (
                  <Box sx={{ maxHeight: 150, overflowY: 'auto', border: '1px solid', borderColor: 'divider', p: 1, mb: 2 }}>
                      <Typography variant="caption" display="block" gutterBottom>Selected:</Typography>
                      <ul>
                          {Array.from(uploadModalState.selectedFiles).map((file, index) => (
                              <li key={index}>
                                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                                      {/* Display relative path for folders, name for files if webkitdirectory wasn't fully effective */}
                                      {/* @ts-ignore */}
                                      {file.webkitRelativePath || file.name}
                                  </Typography>
                              </li>
                          ))}
                      </ul>
                  </Box>
              )}
              {(!uploadModalState.selectedFiles || uploadModalState.selectedFiles.length === 0) && (
                   <Typography variant="caption" sx={{ fontStyle: 'italic', display: 'block', mb: 2 }}>
                       No files selected. {/* Changed back */} 
                   </Typography>
              )}

          </DialogContent>
          <DialogActions>
              <Button onClick={handleCloseUploadModal} disabled={uploadModalState.isUploading}>Cancel</Button>
              <Button 
                  onClick={handleConfirmUpload} 
                  disabled={!uploadModalState.destinationPath || !uploadModalState.selectedFiles || uploadModalState.selectedFiles.length === 0 || uploadModalState.isUploading} 
                  variant="contained"
                  startIcon={uploadModalState.isUploading ? <CircularProgress size={20} color="inherit" /> : null}
              >
                  {uploadModalState.isUploading ? "Uploading..." : "Upload"}
              </Button>
          </DialogActions>
      </Dialog>

      {/* --- Upload Snackbar (NEW) */}
      <Snackbar 
          open={uploadModalState.snackbar?.open || false} 
          autoHideDuration={6000} 
          onClose={handleCloseUploadSnackbar}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
          <Alert onClose={handleCloseUploadSnackbar} severity={uploadModalState.snackbar?.severity || 'info'} sx={{ width: '100%' }}>
              {uploadModalState.snackbar?.message}
          </Alert>
      </Snackbar>

    </>
  );
} 