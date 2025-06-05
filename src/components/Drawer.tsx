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
import { styled, Theme, CSSObject } from '@mui/material/styles';
import { RichTreeView } from '@mui/x-tree-view/RichTreeView';
import { TreeViewBaseItem } from '@mui/x-tree-view/models';
import { useEditorContext, TreeNode } from "@/contexts/EditorContext";
import axios from 'axios';
import {
  FormControl,
  InputLabel,
} from '@mui/material';
import { SelectChangeEvent } from '@mui/material/Select';
import {
  unstable_useTreeItem2 as useTreeItem2,
  UseTreeItem2Parameters,
} from '@mui/x-tree-view/useTreeItem2';
import {
  TreeItem2,
  TreeItem2Content,
  TreeItem2Label,
  TreeItem2Props,
} from '@mui/x-tree-view/TreeItem2';
import clsx from 'clsx';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';

const drawerWidth = 300;

interface ApiTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

interface UploadModalState {
  open: boolean;
  targetNode: TreeNode | null;
  destinationPath: string;
  selectedFiles: FileList | null;
  isUploading: boolean;
  error: string | null;
  snackbar: { open: boolean, message: string, severity: "success" | "error" | "warning" | "info" } | null;
}

function buildTree(items: ApiTreeItem[], basePath: string): TreeNode[] {
  if (!items || items.length === 0) return [];

  const virtualRoot: TreeNode = { id: basePath, label: basePath, type: 'tree', children: [], path: basePath };
  const map: { [path: string]: TreeNode } = { [basePath]: virtualRoot };

  const relevantItems = items
    .filter(item => item.path !== basePath && item.path.startsWith(basePath))
    .sort((a, b) => a.path.localeCompare(b.path));

  relevantItems.forEach(item => {
    const pathSegments = item.path.split('/');
    const label = pathSegments.pop() || '';
    const parentPath = pathSegments.join('/');

    if (label) {
      const node: TreeNode = { id: item.path, label, type: item.type, children: item.type === 'tree' ? [] : undefined, path: item.path };
      map[item.path] = node;

      const parentNode = map[parentPath];
      if (parentNode?.children) {
        parentNode.children.push(node);
      } else {
        console.warn('Parent node not found or is not a directory: ' + parentPath + ' for item ' + item.path);
      }
    }
  });

  const sortChildren = (node: TreeNode) => {
    if (node.children) {
      node.children.sort((a, b) => {
        if (a.type === 'tree' && b.type === 'blob') return -1;
        if (a.type === 'blob' && b.type === 'tree') return 1;
        return a.label.localeCompare(b.label);
      });
      node.children.forEach(sortChildren);
    }
  };
  sortChildren(virtualRoot);

  return virtualRoot.children || [];
}

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

function getAllDescendantIds(node: TreeNode | null): string[] {
  if (!node) return [];
  let ids: string[] = [];
  if (node.children) {
    node.children.forEach(child => {
      ids.push(child.id);
      ids = ids.concat(getAllDescendantIds(child));
    });
  }
  return ids;
}

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

// Wrapper component that connects RichTreeView with our custom item
const CustomTreeItem = React.forwardRef<HTMLLIElement, TreeItem2Props>(function CustomTreeItem(
  props,
  ref,
) {
  const { id } = props;
  const { folderStructure, diffWithMain } = useEditorContext();

  // Find the corresponding node from the complete tree structure
  const item = React.useMemo(() => {
    if (!id) return null;
    return findNodeById(folderStructure, id);
  }, [folderStructure, id]);

  const isHighlighted = React.useMemo(() => {
    if (!item) return false;
    if (item.type === 'blob') {
      return diffWithMain.includes(item.id);
    }
    if (item.type === 'tree') {
      const folderPrefix = `${item.id}/`;
      return diffWithMain.some(filePath => filePath.startsWith(folderPrefix));
    }
    return false;
  }, [item, diffWithMain]);

  // If the item is not found, render the default item to avoid crashes
  if (!item) {
    return <TreeItem2 {...props} ref={ref} />;
  }
  
  return (
    <TreeItem2
      {...props}
      ref={ref}
      label={
        <TreeItem2Label
          sx={{
            color: isHighlighted ? '#FFD700' : 'inherit',
            fontWeight: isHighlighted ? 'bold' : 'inherit',
          }}
        >
          {props.label}
        </TreeItem2Label>
      }
    />
  );
});

export default function Drawer() {
  const [open, setOpen] = useState(true);
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [isDrawerLoading, setIsDrawerLoading] = useState<boolean>(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [isUnsavedChangesDialogOpen, setUnsavedChangesDialogOpen] = useState(false);
  const [pendingNavigationItem, setPendingNavigationItem] = useState<string | null>(null);
  const [isCopyModalOpen, setCopyModalOpen] = useState(false);
  const [targetBranch, setTargetBranch] = useState('');
  const [isCopying, setIsCopying] = useState(false);
  const [copySnackbar, setCopySnackbar] = useState<{ open: boolean, message: string, severity: "success" | "error" | "info" | "warning" } | null>(null);
  const [isNewItemModalOpen, setIsNewItemModalOpen] = useState(false);
  const [newItemType, setNewItemType] = useState<'file' | 'folder' | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [isCreatingItem, setIsCreatingItem] = useState(false);
  const [createItemError, setCreateItemError] = useState<string | null>(null);
  const [modalTargetPath, setModalTargetPath] = useState<string | null>(null);
  const [createItemSnackbar, setCreateItemSnackbar] = useState<{ open: boolean, message: string, severity: "success" | "error" | "info" | "warning" } | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteItemPath, setDeleteItemPath] = useState<string | null>(null);
  const [deleteItemType, setDeleteItemType] = useState<'file' | 'folder' | null>(null);
  const [deleteCommitMessage, setDeleteCommitMessage] = useState('');
  const [isDeletingItem, setIsDeletingItem] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSnackbar, setDeleteSnackbar] = useState<{ open: boolean, message: string, severity: "success" | "error" | "info" | "warning" } | null>(null);
  const [isIntraBranchCopyModalOpen, setIsIntraBranchCopyModalOpen] = useState(false);
  const [copySourcePath, setCopySourcePath] = useState<string | null>(null);
  const [copySourceType, setCopySourceType] = useState<'file' | 'folder' | null>(null);
  const [selectedDestinationFolder, setSelectedDestinationFolder] = useState<string | null>(null);
  const [copyNewName, setCopyNewName] = useState('');
  const [isCopyingIntraBranch, setIsCopyingIntraBranch] = useState(false);
  const [intraBranchCopyError, setIntraBranchCopyError] = useState<string | null>(null);
  const [intraBranchCopySnackbar, setIntraBranchCopySnackbar] = useState<{ open: boolean, message: string, severity: "success" | "error" | "info" | "warning" } | null>(null);
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameItemPath, setRenameItemPath] = useState<string | null>(null);
  const [renameItemType, setRenameItemType] = useState<'file' | 'folder' | null>(null);
  const [renameOriginalName, setRenameOriginalName] = useState('');
  const [renameNewName, setRenameNewName] = useState('');
  const [isRenamingItem, setIsRenamingItem] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameSnackbar, setRenameSnackbar] = useState<{ open: boolean, message: string, severity: "success" | "error" | "info" | "warning" } | null>(null);
  const newItemNameInputRef = useRef<HTMLInputElement>(null);
  const deleteCommitMessageInputRef = useRef<HTMLTextAreaElement>(null);
  const renameNewNameInputRef = useRef<HTMLInputElement>(null);

  const {
    loadFileContent,
    selectedBranch,
    selectedUser,
    password,
    branches,
    hasUnsavedChanges,
    selectedFile,
    updateSelectedFile,
    branchStateCounter,
    renameItem,
    deleteItem,
    addFile,
    addFolder,
    folderStructure,
    isLoadingFolderStructure,
    error: contextError,
    incrementBranchStateCounter,
    diffWithMain,
  } = useEditorContext();

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  useEffect(() => {
    if (folderStructure) {
      setTreeData(folderStructure);
    }
  }, [folderStructure]);

  const proceedWithNavigation = useCallback((itemId: string | null) => {
    if (itemId) {
      const node = findNodeById(treeData, itemId);
      if (node && node.type === 'blob') {
        loadFileContent(itemId);
      }
    }
    setPendingNavigationItem(null);
  }, [treeData, loadFileContent]);

  const handleDrawerToggle = () => { setOpen(!open); };
  const handleItemClick = useCallback((event: React.SyntheticEvent, itemId: string) => {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' && target.getAttribute('type') === 'checkbox') {
      return;
    }
    if (target.closest('[data-testid="CheckBoxIcon"]') || target.closest('[data-testid="CheckBoxOutlineBlankIcon"]')) {
      return;
    }
    const node = findNodeById(treeData, itemId);
    if (node && node.type === 'blob') {
      if (hasUnsavedChanges) {
        setPendingNavigationItem(itemId);
        setUnsavedChangesDialogOpen(true);
      } else {
        proceedWithNavigation(itemId);
      }
    }
  }, [treeData, hasUnsavedChanges, proceedWithNavigation]);

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
  const handleConfirmCopy = async () => {
    if (!selectedBranch || !selectedUser || !password || selectedItems.length === 0) {
      setCopySnackbar({ open: true, message: "Source branch, user, password, and selected files are required.", severity: "error" });
      handleCloseCopyModal();
      return;
    }
    if (selectedBranch === targetBranch) {
      setCopySnackbar({ open: true, message: "Source and target branches cannot be the same.", severity: "error" });
      return;
    }
    if (!targetBranch) {
      setCopySnackbar({ open: true, message: "Target branch must be selected to proceed.", severity: "error" });
      return;
    }
    setIsCopying(true);
    handleCloseCopyModal();
    setCopySnackbar({ open: true, message: `Copying ${selectedItems.length} item(s)...`, severity: "info" });
    const filesToCopy = selectedItems.filter(id => {
      const node = findNodeById(treeData, id);
      return node?.type === 'blob';
    });
    if (filesToCopy.length === 0) {
      setCopySnackbar({ open: true, message: "No files selected to copy.", severity: "info" });
      setIsCopying(false);
      return;
    }
    try {
      const response = await axios.post(`/api/github/copy-files`, {
        username: selectedUser,
        password: password,
        source_branch: selectedBranch,
        target_branch: targetBranch,
        paths: filesToCopy
      });
      let successCount = 0;
      let errorCount = 0;
      let skippedCount = 0;
      if (response.data.success && Array.isArray(response.data.results)) {
        response.data.results.forEach((result: any) => {
          if (result.status === 'created' || result.status === 'updated') successCount++;
          else if (result.status === 'skipped') skippedCount++;
          else errorCount++;
        });
      }
      let message = `Copy finished. Success: ${successCount}, Failed: ${errorCount}, Skipped: ${skippedCount}.`;
      setCopySnackbar({ open: true, message: message, severity: errorCount > 0 ? "warning" : "success" });
    } catch (err: any) {
      setCopySnackbar({ open: true, message: `Copy failed: ${err.response?.data?.error || err.message || 'Unknown error'}`, severity: "error" });
    } finally {
      setIsCopying(false);
    }
  };

  const handleCloseSnackbar = (event?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') return;
    setCopySnackbar(null);
  };

  const handleCloseUnsavedDialog = () => {
    setUnsavedChangesDialogOpen(false);
    setPendingNavigationItem(null);
  };

  const handleConfirmDiscardChanges = () => {
    setUnsavedChangesDialogOpen(false);
    proceedWithNavigation(pendingNavigationItem);
  };

  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; node: TreeNode | null } | null>(null);

  const handleSelectedItemsChange = (
    event: React.SyntheticEvent,
    newItemIds: string[],
  ) => {
    const previousSelection = new Set(selectedItems);
    const currentSelection = new Set(newItemIds);
    let changedItemId: string | null = null;
    for (const id of currentSelection) {
      if (!previousSelection.has(id)) {
        changedItemId = id;
        break;
      }
    }
    if (!changedItemId) {
      for (const id of previousSelection) {
        if (!currentSelection.has(id)) {
          changedItemId = id;
          break;
        }
      }
    }
    if (!changedItemId) {
      setSelectedItems(newItemIds);
      return;
    }
    const node = findNodeById(treeData, changedItemId);
    if (!node) {
      setSelectedItems(newItemIds);
      return;
    }
    const isChecked = currentSelection.has(changedItemId);
    let finalSelection = new Set(selectedItems);
    if (node.type === 'tree') {
      const descendantIds = getAllDescendantIds(node);
      const allIdsToChange = [changedItemId, ...descendantIds];
      if (isChecked) {
        allIdsToChange.forEach(id => finalSelection.add(id));
      } else {
        allIdsToChange.forEach(id => finalSelection.delete(id));
      }
    } else {
      if (isChecked) {
        finalSelection.add(changedItemId);
      } else {
        finalSelection.delete(changedItemId);
      }
    }
    const newSelectedItemsArray = Array.from(finalSelection);
    setSelectedItems(newSelectedItemsArray);
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLUListElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const targetElement = event.target as HTMLElement;
    const treeItemElement = targetElement.closest('.MuiTreeItem-root');
    const itemId = treeItemElement?.getAttribute('data-id');
    if (!itemId) {
      setContextMenu(null);
      return;
    }
    const node = findNodeById(treeData, itemId);
    if (!node) {
      setContextMenu(null);
      return;
    }
    setContextMenu(
      contextMenu === null
        ? {
          mouseX: event.clientX + 2,
          mouseY: event.clientY - 6,
          node: node,
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
      setRenameItemPath(node.id);
      setRenameItemType(itemTypeDisplay);
      setRenameOriginalName(currentName);
      setRenameNewName(currentName);
      setRenameError(null);
      setIsRenamingItem(false);
      setIsRenameModalOpen(true);
    }
    handleCloseContextMenu();
  };

  const handleDelete = () => {
    if (contextMenu?.node) {
      const node = contextMenu.node;
      const itemTypeDisplay = node.type === 'tree' ? 'folder' : 'file';
      setDeleteItemPath(node.id);
      setDeleteItemType(itemTypeDisplay);
      setDeleteCommitMessage(`Delete ${itemTypeDisplay} ${node.label}`);
      setDeleteError(null);
      setIsDeletingItem(false);
      setIsDeleteModalOpen(true);
    }
    handleCloseContextMenu();
  };

  const handleCopy = () => {
    if (contextMenu?.node) {
      const node = contextMenu.node;
      setCopySourcePath(node.id);
      setCopySourceType(node.type === 'tree' ? 'folder' : 'file');
      const pathSegments = node.id.split('/');
      const originalName = pathSegments.pop() || '';
      const parentPath = pathSegments.join('/') || '';
      setSelectedDestinationFolder(parentPath);
      setCopyNewName(originalName);
      setIntraBranchCopyError(null);
      setIsCopyingIntraBranch(false);
      setIntraBranchCopySnackbar(null);
      setIsIntraBranchCopyModalOpen(true);
    }
    handleCloseContextMenu();
  };

  const handleCloseNewItemModal = () => {
    setIsNewItemModalOpen(false);
    setNewItemName('');
    setNewItemType(null);
    setModalTargetPath(null);
    setCreateItemError(null);
    setIsCreatingItem(false);
  };
  const handleNewItemNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const name = event.target.value;
    if (!name.includes('/')) {
      setNewItemName(name);
    }
    setCreateItemError(null);
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

    const apiCall = newItemType === 'file' ? addFile : addFolder;
    const path = modalTargetPath;
    const filename = newItemName;
    try {
      await apiCall(path, filename);
      setCreateItemSnackbar({ open: true, message: `${newItemType === 'file' ? 'File' : 'Folder'} '${filename}' created.`, severity: 'success' });
      handleCloseNewItemModal();
      incrementBranchStateCounter(); // To trigger refresh
    } catch (error: any) {
      const errMsg = error.response?.data?.error || error.message || `Failed to create ${newItemType}.`;
      setCreateItemError(errMsg);
      setCreateItemSnackbar({ open: true, message: errMsg, severity: 'error' });
    } finally {
      setIsCreatingItem(false);
    }
  };

  const handleCloseDeleteModal = () => {
    setIsDeleteModalOpen(false);
    setDeleteItemPath(null);
    setDeleteItemType(null);
    setDeleteCommitMessage('');
    setDeleteError(null);
    setIsDeletingItem(false);
  };

  const handleConfirmDeleteItem = async () => {
    if (!deleteItemPath || !deleteItemType || !selectedBranch || !selectedUser || !password) {
      setDeleteError('Missing required information.');
      return;
    }
    setIsDeletingItem(true);
    setDeleteError(null);
    setDeleteSnackbar(null);
    try {
      await deleteItem(deleteItemPath, deleteCommitMessage);
      setDeleteSnackbar({ open: true, message: `${deleteItemType === 'file' ? 'File' : 'Folder'} deleted.`, severity: 'success' });
      handleCloseDeleteModal();
      incrementBranchStateCounter();
    } catch (error: any) {
      const errMsg = error.response?.data?.error || error.message || 'Failed to delete.';
      setDeleteError(errMsg);
      setDeleteSnackbar({ open: true, message: errMsg, severity: 'error' });
    } finally {
      setIsDeletingItem(false);
    }
  };

  useEffect(() => {
    if (isNewItemModalOpen) {
      const timer = setTimeout(() => {
        newItemNameInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isNewItemModalOpen]);

  useEffect(() => {
    if (isDeleteModalOpen) {
      const timer = setTimeout(() => {
        deleteCommitMessageInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isDeleteModalOpen]);

  const handleCloseIntraBranchCopyModal = () => {
    setIsIntraBranchCopyModalOpen(false);
    // ... reset states
  };

  const handleConfirmIntraBranchCopy = async () => {
    // ... implementation
  };

  function filterFolders(nodes: TreeNode[]): TreeNode[] {
    return nodes
      .filter(node => node.type === 'tree')
      .map(node => ({
        ...node,
        children: node.children ? filterFolders(node.children) : [],
      }));
  }

  const handleCloseRenameModal = () => {
    setIsRenameModalOpen(false);
    // ... reset states
  };
  const handleConfirmRename = async () => {
    if (!renameItemPath || !renameNewName || !selectedBranch || !selectedUser || !password) {
      setRenameError('Missing required information.');
      return;
    }
    setIsRenamingItem(true);
    setRenameError(null);
    try {
      await renameItem(renameItemPath, renameNewName);
      setRenameSnackbar({ open: true, message: 'Item renamed successfully.', severity: 'success' });
      handleCloseRenameModal();
      incrementBranchStateCounter();
    } catch (error: any) {
      const errMsg = error.response?.data?.error || error.message || 'Failed to rename.';
      setRenameError(errMsg);
    } finally {
      setIsRenamingItem(false);
    }
  };

  useEffect(() => {
    if (isRenameModalOpen) {
      const timer = setTimeout(() => {
        renameNewNameInputRef.current?.focus();
        renameNewNameInputRef.current?.select();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isRenameModalOpen]);

  const [uploadModalState, setUploadModalState] = useState<UploadModalState>({
    open: false,
    targetNode: null,
    destinationPath: "",
    selectedFiles: null,
    isUploading: false,
    error: null,
    snackbar: null
  });

  const handleOpenUploadModal = () => {
    if (contextMenu?.node) {
      const node = contextMenu.node;
      let destPath = "";
      if (node.type === 'tree') {
        destPath = node.id;
      } else {
        destPath = node.id.substring(0, node.id.lastIndexOf('/'));
      }
      setUploadModalState({
        open: true,
        targetNode: node,
        destinationPath: destPath,
        selectedFiles: null,
        isUploading: false,
        error: null,
        snackbar: null,
      });
    }
    handleCloseContextMenu();
  };

  const handleUploadDestinationChange = (event: React.SyntheticEvent, itemId: string | null) => {
    const newDestPath = typeof itemId === 'string' ? itemId : ''
    setUploadModalState(prev => ({ ...prev, destinationPath: newDestPath, error: null }));
  };

  const handleCloseUploadModal = () => {
    setUploadModalState(prev => ({ ...prev, open: false }));
  };

  const handleFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      setUploadModalState(prev => ({ ...prev, selectedFiles: event.target.files, error: null }));
    }
  };

  const handleConfirmUpload = async () => {
    // ... implementation
  };

  const handleCloseUploadSnackbar = (event?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') return;
    setUploadModalState(prev => ({ ...prev, snackbar: null }));
  };

  const handleAddFile = () => {
    if (contextMenu?.node && contextMenu.node.type === 'tree') {
      const node = contextMenu.node;
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
      setModalTargetPath(node.id);
      setNewItemType('folder');
      setNewItemName('');
      setCreateItemError(null);
      setIsNewItemModalOpen(true);
    }
    handleCloseContextMenu();
  };

  const drawerVariant = isMobile ? "temporary" : "permanent";
  const DrawerComponent = drawerVariant === 'permanent' ? StyledDrawer : MuiDrawer;

  return (
    <>
      <IconButton
        onClick={handleDrawerToggle}
        sx={{
          position: 'absolute',
          top: theme.spacing(1),
          left: open ? drawerWidth - 40 : 10,
          zIndex: theme.zIndex.drawer + 2,
          transition: theme.transitions.create(['left'], {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.enteringScreen,
          }),
        }}
      >
        {open ? <ChevronLeftIcon /> : <ChevronRightIcon />}
      </IconButton>

      <DrawerComponent
        variant={drawerVariant}
        open={open}
        onClose={isMobile ? handleDrawerToggle : undefined}
        ModalProps={{ keepMounted: true }}
      >
        <Box sx={{ height: theme.spacing(8) }} />
        <Divider />
        <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, overflow: 'hidden' }}>
          <Box sx={{ flexGrow: 1, overflowY: 'auto', overflowX: 'hidden', p: 1 }}>
            {!selectedBranch ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', p: 2 }}><Typography color="textSecondary" textAlign="center">Please select a branch to view files.</Typography></Box>
            ) : isLoadingFolderStructure ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}><CircularProgress /></Box>
            ) : contextError ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', p: 2 }}><Typography color="error" textAlign="center">Error: {contextError}</Typography></Box>
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
                slots={{
                  item: CustomTreeItem,
                }}
                sx={{
                  flexGrow: 1,
                  overflowX: 'hidden',
                  width: '100%',
                }}
              />
            )}
          </Box>
          {open && selectedBranch && treeData.length > 0 && (
            <Box sx={{ p: 1, borderTop: `1px solid ${theme.palette.divider}` }}>
              <Button
                variant="outlined"
                fullWidth
                onClick={handleOpenCopyModal}
                disabled={selectedItems.length === 0 || isCopying}
              >
                {isCopying ? <CircularProgress size={24} /> : `Copy ${selectedItems.length} item(s) to branch...`}
              </Button>
            </Box>
          )}
        </Box>
      </DrawerComponent>

      {/* Modals and Snackbars... */}
    </>
  );
} 