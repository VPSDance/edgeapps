import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Accordion,
  ActionIcon,
  AppShell,
  Badge,
  Box,
  Button,
  Checkbox,
  Code,
  Divider,
  Group,
  MantineProvider,
  Modal,
  Paper,
  Popover,
  ScrollArea,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Tooltip,
  Title,
  UnstyledButton
} from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import {
  IconAlertCircle,
  IconCheck,
  IconCopy,
  IconInfoCircle,
  IconRefresh,
  IconRotateClockwise,
  IconSearch,
  IconTrash,
  IconX
} from '@tabler/icons-react';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './admin-app.css';

const PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 380;

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...options
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const reason = data?.reason || data?.error || res.status;
    throw new Error(String(reason));
  }
  return data;
}

function formatDateTimeShort(raw) {
  const value = String(raw || '').trim();
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}:${ss}`;
}

function formatRelativeTimeAgo(raw) {
  const value = String(raw || '').trim();
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  const diffMs = Math.max(0, Date.now() - date.getTime());
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}h ago`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  const year = Math.floor(month / 12);
  return `${year}y ago`;
}

function formatVersionCountLabel(value) {
  const count = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  return `${count} version${count === 1 ? '' : 's'}`;
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`;
  }
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(gb < 10 ? 2 : 1)} GB`;
}

function toSortedPackages(pkgMap) {
  return Array.from(pkgMap.values()).sort((a, b) => {
    const byModified = String(b?.modified || '').localeCompare(String(a?.modified || ''));
    if (byModified !== 0) return byModified;
    return String(a?.name || '').localeCompare(String(b?.name || ''));
  });
}

function sortTokensByCreated(items) {
  return [...items].sort((a, b) => String(b?.created_at || '').localeCompare(String(a?.created_at || '')));
}

function parseRuleList(raw, label) {
  const text = String(raw || '').trim();
  if (!text) return { ok: true, rules: [] };
  const parts = text.split(',').map((s) => s.trim());
  if (parts.some((s) => !s)) {
    return { ok: false, reason: `${label} has empty rule item.` };
  }
  const invalid = parts.find((s) => !/^[a-zA-Z0-9@._/*-]+$/.test(s));
  if (invalid) {
    return { ok: false, reason: `${label} has invalid rule: ${invalid}` };
  }
  return { ok: true, rules: parts };
}

function maskTokenValue(raw) {
  const value = String(raw || '');
  if (!value) return '';
  if (value.length <= 12) return '•'.repeat(value.length);
  return value.slice(0, 6) + '••••••••••••' + value.slice(-4);
}

function normalizeRuleList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item || '').trim()).filter(Boolean);
}

function App() {
  const [whoami, setWhoami] = useState('-');
  const [isAdmin, setIsAdmin] = useState(false);
  const [tokenManagementEnabled, setTokenManagementEnabled] = useState(false);

  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [packages, setPackages] = useState([]);
  const [cursor, setCursor] = useState('');
  const [listLoading, setListLoading] = useState(false);
  const [totalVisible, setTotalVisible] = useState(null);
  const [totalExact, setTotalExact] = useState(true);

  const [detail, setDetail] = useState(null);
  const [currentPackage, setCurrentPackage] = useState('');
  const [detailTab, setDetailTab] = useState('versions');
  const [distTagHelpOpen, setDistTagHelpOpen] = useState(false);

  const [tagName, setTagName] = useState('latest');
  const [tagVersion, setTagVersion] = useState('');
  const [deleteVersion, setDeleteVersion] = useState('');

  const [tokenItems, setTokenItems] = useState([]);

  const [createTokenDialogOpen, setCreateTokenDialogOpen] = useState(false);
  const [editTokenDialogOpen, setEditTokenDialogOpen] = useState(false);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [deleteTokenDialogOpen, setDeleteTokenDialogOpen] = useState(false);
  const [rotateTokenDialogOpen, setRotateTokenDialogOpen] = useState(false);
  const [deleteVersionDialogOpen, setDeleteVersionDialogOpen] = useState(false);

  const [pendingDeleteToken, setPendingDeleteToken] = useState(null);
  const [pendingRotateToken, setPendingRotateToken] = useState(null);

  const [tokenUsernameInput, setTokenUsernameInput] = useState('');
  const [tokenReadInput, setTokenReadInput] = useState('');
  const [tokenWriteInput, setTokenWriteInput] = useState('');
  const [tokenAdminInput, setTokenAdminInput] = useState(false);

  const [editTokenId, setEditTokenId] = useState('');
  const [editTokenUsername, setEditTokenUsername] = useState('');
  const [editTokenReadInput, setEditTokenReadInput] = useState('');
  const [editTokenWriteInput, setEditTokenWriteInput] = useState('');
  const [editTokenAdminInput, setEditTokenAdminInput] = useState(false);

  const [createdToken, setCreatedToken] = useState('');
  const [showCreatedToken, setShowCreatedToken] = useState(false);

  const listRequestSeqRef = useRef(0);
  const packageMapRef = useRef(new Map());
  const didInitRef = useRef(false);
  const distTagHelpCloseTimerRef = useRef(null);

  const isCreateAdminRoleToken = isAdmin && tokenAdminInput;
  const isEditAdminRoleToken = isAdmin && editTokenAdminInput;

  const renderAclCell = useCallback((rulesRaw) => {
    const rules = normalizeRuleList(rulesRaw);
    if (!rules.length) return <Text size="xs" c="dimmed">-</Text>;
    if (rules.length === 1 && rules[0] === '*') {
      return (
        <Badge size="xs" variant="light" className="token-acl-badge">
          *
        </Badge>
      );
    }
    return <Text size="xs" className="token-acl-text">{rules.join(', ')}</Text>;
  }, []);

  const showToast = useCallback((message, kind = 'info') => {
    const color = kind === 'error' ? 'red' : kind === 'success' ? 'green' : 'blue';
    notifications.show({
      message: String(message || ''),
      color,
      autoClose: 2200,
      withCloseButton: true,
      icon: kind === 'error' ? <IconAlertCircle size={16} /> : undefined
    });
  }, []);

  const clearDistTagHelpCloseTimer = useCallback(() => {
    if (!distTagHelpCloseTimerRef.current) return;
    clearTimeout(distTagHelpCloseTimerRef.current);
    distTagHelpCloseTimerRef.current = null;
  }, []);

  const openDistTagHelp = useCallback(() => {
    clearDistTagHelpCloseTimer();
    setDistTagHelpOpen(true);
  }, [clearDistTagHelpCloseTimer]);

  const closeDistTagHelpSoon = useCallback(() => {
    clearDistTagHelpCloseTimer();
    distTagHelpCloseTimerRef.current = setTimeout(() => {
      setDistTagHelpOpen(false);
      distTagHelpCloseTimerRef.current = null;
    }, 120);
  }, [clearDistTagHelpCloseTimer]);

  const toggleDistTagHelp = useCallback(() => {
    clearDistTagHelpCloseTimer();
    setDistTagHelpOpen((prev) => !prev);
  }, [clearDistTagHelpCloseTimer]);

  const resetTokenForm = useCallback(() => {
    setTokenUsernameInput('');
    setTokenReadInput('');
    setTokenWriteInput('');
    setTokenAdminInput(false);
    setCreateTokenDialogOpen(false);
  }, []);

  const resetEditTokenForm = useCallback(() => {
    setEditTokenId('');
    setEditTokenUsername('');
    setEditTokenReadInput('');
    setEditTokenWriteInput('');
    setEditTokenAdminInput(false);
    setEditTokenDialogOpen(false);
  }, []);

  const loadWhoAmI = useCallback(async () => {
    try {
      const data = await fetchJson('/_/api/admin/whoami');
      setWhoami(String(data?.username || '-'));
      setIsAdmin(Boolean(data?.is_admin));
      setTokenManagementEnabled(Boolean(data?.token_management));
      resetTokenForm();
      resetEditTokenForm();
    } catch (err) {
      setWhoami('-');
      setIsAdmin(false);
      setTokenManagementEnabled(false);
      resetTokenForm();
      resetEditTokenForm();
      showToast('Whoami failed: ' + err.message, 'error');
    }
  }, [resetEditTokenForm, resetTokenForm, showToast]);

  const loadTokens = useCallback(async () => {
    if (!tokenManagementEnabled) {
      setTokenItems([]);
      return;
    }
    try {
      const data = await fetchJson('/_/api/admin/tokens');
      const items = sortTokensByCreated(Array.isArray(data?.items) ? data.items : []);
      setTokenItems(items);
      if (editTokenId && !items.some((item) => item?.token_id === editTokenId)) {
        resetEditTokenForm();
      }
    } catch (err) {
      showToast('Load tokens failed: ' + err.message, 'error');
    }
  }, [editTokenId, resetEditTokenForm, showToast, tokenManagementEnabled]);

  const loadPackages = useCallback(
    async ({ append = false, nextQuery = query } = {}) => {
      const requestSeq = ++listRequestSeqRef.current;
      setListLoading(true);

      try {
        if (!append) {
          setQuery(String(nextQuery || '').trim());
          setTotalVisible(null);
          setTotalExact(true);
          packageMapRef.current = new Map();
          setPackages([]);
          setCursor('');
        }

        const effectiveQuery = String(nextQuery || '').trim();
        const q = effectiveQuery ? '&q=' + encodeURIComponent(effectiveQuery) : '';
        const cursorPart = append && cursor ? '&cursor=' + encodeURIComponent(cursor) : '';
        const withTotal = append ? '' : '&with_total=1';
        const data = await fetchJson('/_/api/admin/packages?limit=' + PAGE_SIZE + q + cursorPart + withTotal);

        if (requestSeq !== listRequestSeqRef.current) return;

        const nextMap = append ? new Map(packageMapRef.current) : new Map();
        for (const item of data?.items || []) {
          const name = String(item?.name || '').trim();
          if (!name) continue;
          nextMap.set(name, item);
        }
        packageMapRef.current = nextMap;
        setPackages(toSortedPackages(nextMap));
        setCursor(data?.next_cursor || '');
        if (!append && Number.isFinite(data?.total_visible)) {
          setTotalVisible(data.total_visible);
          setTotalExact(data?.total_exact !== false);
        }
        setListLoading(false);
      } catch (err) {
        if (requestSeq !== listRequestSeqRef.current) return;
        setListLoading(false);
        showToast('Load packages failed: ' + err.message, 'error');
      }
    },
    [cursor, query, showToast]
  );

  const loadPackageDetail = useCallback(
    async (name) => {
      if (!name) return;
      try {
        const data = await fetchJson('/_/api/admin/package?name=' + encodeURIComponent(name));
        setDetail(data);
        setCurrentPackage(data?.name || name);
        const firstVersion = data?.versions?.[0]?.version || '';
        setTagVersion(firstVersion);
        setDeleteVersion(firstVersion);
        setDetailTab('versions');
      } catch (err) {
        showToast('Load package failed: ' + err.message, 'error');
      }
    },
    [showToast]
  );

  const onSetDistTag = useCallback(async () => {
    if (!currentPackage) return;
    const tag = String(tagName || '').trim();
    const version = String(tagVersion || '').trim();
    if (!tag || !version) {
      showToast('Tag/version required', 'error');
      return;
    }

    try {
      await fetchJson('/_/api/admin/dist-tag', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: currentPackage, tag, version })
      });
      await loadPackageDetail(currentPackage);
      showToast('Dist-tag updated', 'success');
    } catch (err) {
      showToast('Set dist-tag failed: ' + err.message, 'error');
    }
  }, [currentPackage, loadPackageDetail, showToast, tagName, tagVersion]);

  const onDeleteVersion = useCallback(async () => {
    if (!currentPackage) return;
    const version = String(deleteVersion || '').trim();
    if (!version) {
      showToast('Version required', 'error');
      return;
    }

    try {
      await fetchJson('/_/api/admin/delete-version', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: currentPackage, version })
      });
      await loadPackageDetail(currentPackage);
      await loadPackages({ append: false, nextQuery: query });
      setDeleteVersionDialogOpen(false);
      showToast('Version deleted', 'success');
    } catch (err) {
      showToast('Delete version failed: ' + err.message, 'error');
    }
  }, [currentPackage, deleteVersion, loadPackageDetail, loadPackages, query, showToast]);

  const onStartEditToken = useCallback((item) => {
    if (!item?.token_id) return;
    setEditTokenId(String(item.token_id));
    setEditTokenUsername(String(item.username || ''));
    setEditTokenAdminInput(Boolean(item.is_admin));
    setEditTokenReadInput(Array.isArray(item.read) ? item.read.join(',') : '');
    setEditTokenWriteInput(Array.isArray(item.write) ? item.write.join(',') : '');
    setEditTokenDialogOpen(true);
  }, []);

  const onCreateToken = useCallback(async () => {
    if (!tokenManagementEnabled) return;
    try {
      const payload = {};
      const username = String(tokenUsernameInput || '').trim();
      if (!username) {
        showToast('User required', 'error');
        return;
      }
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(username)) {
        showToast('Invalid user format', 'error');
        return;
      }
      const readRaw = String(tokenReadInput || '').trim();
      const writeRaw = String(tokenWriteInput || '').trim();
      if (!isCreateAdminRoleToken && !readRaw && !writeRaw) {
        showToast('Set at least one read/write rule for non-admin token', 'error');
        return;
      }
      if (!isCreateAdminRoleToken) {
        const readParsed = parseRuleList(readRaw, 'Read');
        if (!readParsed.ok) {
          showToast(readParsed.reason || 'Invalid read rules', 'error');
          return;
        }
        const writeParsed = parseRuleList(writeRaw, 'Write');
        if (!writeParsed.ok) {
          showToast(writeParsed.reason || 'Invalid write rules', 'error');
          return;
        }
        payload.read = readParsed.rules;
        payload.write = writeParsed.rules;
      }
      payload.is_admin = Boolean(isCreateAdminRoleToken);
      payload.username = username;

      const data = await fetchJson('/_/api/admin/token-create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const savedItem = data?.item;
      if (savedItem?.token_id) {
        setTokenItems((prev) => {
          const filtered = prev.filter((it) => it?.token_id !== savedItem.token_id);
          return sortTokensByCreated([savedItem, ...filtered]);
        });
      }

      setCreatedToken(String(data?.token || ''));
      setShowCreatedToken(false);
      setTokenDialogOpen(true);
      resetTokenForm();
      showToast('Access created', 'success');
    } catch (err) {
      showToast('Create access failed: ' + err.message, 'error');
    }
  }, [
    isCreateAdminRoleToken,
    resetTokenForm,
    showToast,
    tokenManagementEnabled,
    tokenReadInput,
    tokenUsernameInput,
    tokenWriteInput
  ]);

  const onSaveEditToken = useCallback(async () => {
    if (!tokenManagementEnabled) return;
    const tokenId = String(editTokenId || '').trim();
    if (!tokenId) {
      showToast('Token id missing', 'error');
      return;
    }
    try {
      const payload = {
        token_id: tokenId,
        is_admin: Boolean(isEditAdminRoleToken)
      };
      const readRaw = String(editTokenReadInput || '').trim();
      const writeRaw = String(editTokenWriteInput || '').trim();
      if (!isEditAdminRoleToken && !readRaw && !writeRaw) {
        showToast('Set at least one read/write rule for non-admin token', 'error');
        return;
      }
      if (!isEditAdminRoleToken) {
        const readParsed = parseRuleList(readRaw, 'Read');
        if (!readParsed.ok) {
          showToast(readParsed.reason || 'Invalid read rules', 'error');
          return;
        }
        const writeParsed = parseRuleList(writeRaw, 'Write');
        if (!writeParsed.ok) {
          showToast(writeParsed.reason || 'Invalid write rules', 'error');
          return;
        }
        payload.read = readParsed.rules;
        payload.write = writeParsed.rules;
      }
      const data = await fetchJson('/_/api/admin/token-update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const savedItem = data?.item;
      if (savedItem?.token_id) {
        setTokenItems((prev) => {
          const filtered = prev.filter((it) => it?.token_id !== savedItem.token_id);
          return sortTokensByCreated([savedItem, ...filtered]);
        });
      }
      resetEditTokenForm();
      showToast('Access updated', 'success');
    } catch (err) {
      showToast('Update access failed: ' + err.message, 'error');
    }
  }, [
    editTokenId,
    editTokenReadInput,
    editTokenWriteInput,
    isEditAdminRoleToken,
    resetEditTokenForm,
    showToast,
    tokenManagementEnabled
  ]);

  const onDeleteToken = useCallback((item) => {
    const tokenId = String(item?.token_id || '').trim();
    if (!tokenId) return;
    setPendingDeleteToken({
      tokenId,
      username: String(item?.username || '').trim() || 'unknown-user'
    });
    setDeleteTokenDialogOpen(true);
  }, []);

  const onConfirmDeleteToken = useCallback(async () => {
    if (!pendingDeleteToken?.tokenId) return;
    const tokenId = pendingDeleteToken.tokenId;
    const promptUser = pendingDeleteToken.username || 'unknown-user';
    try {
      await fetchJson('/_/api/admin/token-delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token_id: tokenId })
      });
      setTokenItems((prev) => prev.filter((it) => it?.token_id !== tokenId));
      if (editTokenId && editTokenId === tokenId) {
        resetEditTokenForm();
      }
      setDeleteTokenDialogOpen(false);
      setPendingDeleteToken(null);
      showToast(`Token deleted for ${promptUser}`, 'success');
    } catch (err) {
      showToast('Delete token failed: ' + err.message, 'error');
    }
  }, [editTokenId, pendingDeleteToken, resetEditTokenForm, showToast]);

  const onReissueToken = useCallback((item) => {
    const tokenId = String(item?.token_id || '').trim();
    if (!tokenId) return;
    setPendingRotateToken({
      tokenId,
      username: String(item?.username || '').trim() || 'unknown-user'
    });
    setRotateTokenDialogOpen(true);
  }, []);

  const onConfirmRotateToken = useCallback(async () => {
    if (!pendingRotateToken?.tokenId) return;
    const tokenId = pendingRotateToken.tokenId;
    const promptUser = pendingRotateToken.username || 'unknown-user';
    try {
      const data = await fetchJson('/_/api/admin/token-rotate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token_id: tokenId, replace_old: true })
      });
      const nextItem = data?.item;
      const oldId = String(data?.old_token_id || tokenId).trim();
      if (nextItem?.token_id) {
        setTokenItems((prev) => {
          const filtered = prev.filter((it) => it?.token_id !== oldId && it?.token_id !== nextItem.token_id);
          return sortTokensByCreated([nextItem, ...filtered]);
        });
      } else {
        setTokenItems((prev) => prev.filter((it) => it?.token_id !== oldId));
      }
      if (editTokenId && editTokenId === oldId) {
        resetEditTokenForm();
      }
      setCreatedToken(String(data?.token || ''));
      setShowCreatedToken(false);
      setTokenDialogOpen(true);
      setRotateTokenDialogOpen(false);
      setPendingRotateToken(null);
      showToast(`New token generated for ${promptUser}`, 'success');
    } catch (err) {
      showToast('Rotate token failed: ' + err.message, 'error');
    }
  }, [editTokenId, pendingRotateToken, resetEditTokenForm, showToast]);

  const copyCreatedToken = useCallback(async () => {
    const value = String(createdToken || '').trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      showToast('Token copied', 'success');
    } catch {
      showToast('Copy failed', 'error');
    }
  }, [createdToken, showToast]);

  const copyInstallCommand = useCallback(async (text) => {
    const value = String(text || '').trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      showToast('Install command copied', 'success');
    } catch {
      showToast('Copy failed', 'error');
    }
  }, [showToast]);

  const stats = useMemo(() => {
    const total = Number.isFinite(totalVisible) ? String(totalVisible) + (totalExact ? '' : '+') : '?';
    return {
      loaded: String(packages.length),
      total,
      pageSize: String(PAGE_SIZE)
    };
  }, [packages.length, totalExact, totalVisible]);

  const loadMoreLabel = useMemo(() => {
    if (listLoading) return 'Loading...';
    if (cursor) return `Load next ${PAGE_SIZE}`;
    if (packages.length) return 'All loaded';
    return 'No results';
  }, [cursor, listLoading, packages.length]);

  const detailJson = useMemo(() => JSON.stringify(detail || {}, null, 2), [detail]);
  const versions = Array.isArray(detail?.versions) ? detail.versions : [];
  const distTags = detail?.distTags && typeof detail.distTags === 'object' ? detail.distTags : {};

  const versionTagMap = useMemo(() => {
    const map = new Map();
    for (const [tag, version] of Object.entries(distTags)) {
      const key = String(version || '').trim();
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(String(tag));
    }
    for (const tags of map.values()) {
      tags.sort((a, b) => {
        if (a === 'latest') return -1;
        if (b === 'latest') return 1;
        return a.localeCompare(b);
      });
    }
    return map;
  }, [distTags]);

  const registryOrigin = useMemo(() => (typeof window !== 'undefined' ? window.location.origin : ''), []);

  const installCommand = useMemo(() => {
    const pkg = String(currentPackage || '').trim();
    if (!pkg || !registryOrigin) return '';
    if (pkg.startsWith('@') && pkg.includes('/')) {
      const scope = pkg.split('/')[0];
      return `npm config set ${scope}:registry ${registryOrigin}\nnpm i ${pkg}`;
    }
    return `npm i --registry ${registryOrigin} ${pkg}`;
  }, [currentPackage, registryOrigin]);

  const versionSelectData = useMemo(
    () => versions.map((item) => ({ value: item.version, label: item.version })),
    [versions]
  );

  const activeTokenCount = tokenItems.length;
  const activeTokenSummary = useMemo(
    () => `${activeTokenCount} active token${activeTokenCount === 1 ? '' : 's'}`,
    [activeTokenCount]
  );

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    loadWhoAmI();
    loadPackages({ append: false, nextQuery: '' });
  }, [loadPackages, loadWhoAmI]);

  useEffect(() => {
    if (!tokenManagementEnabled) {
      setTokenItems([]);
      return;
    }
    loadTokens();
  }, [loadTokens, tokenManagementEnabled]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = String(queryInput || '').trim();
      if (next === query) return;
      loadPackages({ append: false, nextQuery: next });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [loadPackages, query, queryInput]);

  useEffect(() => () => {
    clearDistTagHelpCloseTimer();
  }, [clearDistTagHelpCloseTimer]);

  return (
    <MantineProvider defaultColorScheme="dark">
      <Notifications position="top-right" zIndex={4000} />
      <AppShell
        header={{ height: 52 }}
        navbar={{ width: '35%', breakpoint: 'lg' }}
        padding={0}
        className="admin-shell"
      >
        <AppShell.Header className="topbar">
          <Box className="layout-container topbar-inner">
            <Box className="topbar-grid">
              <Group gap="xs" className="topbar-brand" wrap="nowrap">
                <Title order={5} className="topbar-title">NPM Registry</Title>
              </Group>

              <Group className="topbar-search" wrap="nowrap">
                <TextInput
                  className="header-search"
                  value={queryInput}
                  onChange={(event) => setQueryInput(event.target.value)}
                  placeholder="Search package"
                  size="sm"
                  leftSection={<IconSearch size={14} />}
                  rightSection={
                    queryInput
                      ? (
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="sm"
                            aria-label="Clear search"
                            onClick={() => {
                              setQueryInput('');
                              loadPackages({ append: false, nextQuery: '' });
                            }}
                          >
                            <IconX size={12} />
                          </ActionIcon>
                        )
                      : null
                  }
                />
              </Group>

              <Group gap="xs" wrap="nowrap" className="topbar-actions">
                <Badge variant="light" color="gray">user: {whoami}</Badge>
                <ActionIcon
                  variant="light"
                  color="gray"
                  aria-label="Refresh packages"
                  title="Refresh packages"
                  loading={listLoading}
                  onClick={() => loadPackages({ append: false, nextQuery: query })}
                >
                  <IconRefresh size={16} />
                </ActionIcon>
              </Group>
            </Box>
          </Box>
        </AppShell.Header>

        <AppShell.Navbar className="packages-nav">
          <Box className="packages-nav-inner">
              <Stack gap="sm">
                <Stack gap={2} className="packages-intro">
                  <Title order={5}>Packages</Title>
                  <Text size="xs" c="dimmed">Pick one package to inspect and manage.</Text>
                </Stack>

              <Group gap={6} className="stats-row packages-stats">
                <Badge variant="light" color="gray">Loaded {stats.loaded}</Badge>
                <Badge variant="light" color="gray">Total {stats.total}</Badge>
                <Badge variant="light" color="gray">Page {stats.pageSize}</Badge>
              </Group>

              <ScrollArea className="packages-scroll">
                <Stack gap={4} className="packages-list">
                  {packages.length ? packages.map((item) => {
                    const active = currentPackage && currentPackage === item.name;
                    const latestVersion = String(item.latest || '').trim();
                    const versionCount = Number.isFinite(Number(item.version_count))
                      ? Math.max(0, Number(item.version_count))
                      : 0;
                    const versionCountLabel = formatVersionCountLabel(versionCount);
                    return (
                      <UnstyledButton
                        key={item.name}
                        className={active ? 'pkg-item is-active' : 'pkg-item'}
                        onClick={() => loadPackageDetail(item.name)}
                      >
                        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
                          <Text fw={600} size="sm" className="pkg-item-name">{item.name || ''}</Text>
                          <Tooltip label={versionCountLabel} withArrow position="top-end" openDelay={120} color="dark">
                            <Badge variant="light" color="gray" size="xs" className="pkg-count-badge">
                              {versionCount}
                            </Badge>
                          </Tooltip>
                        </Group>
                        <Group justify="space-between" align="center" wrap="nowrap" className="pkg-meta-row">
                          <Badge size="xs" variant="light" color="indigo" className="pkg-meta-version">
                            {latestVersion ? `v${latestVersion}` : 'v-'}
                          </Badge>
                          <Tooltip label={formatDateTimeShort(item.modified)} withArrow position="top-end" openDelay={120} color="dark">
                            <Text size="xs" className="pkg-meta-time">{formatRelativeTimeAgo(item.modified)}</Text>
                          </Tooltip>
                        </Group>
                      </UnstyledButton>
                    );
                  }) : (
                    <Text size="sm" c="dimmed" className="packages-empty">No package found.</Text>
                  )}
                </Stack>
              </ScrollArea>

              <Group justify="flex-end" className="packages-footer">
                <Button
                  size="xs"
                  variant="default"
                  color="gray"
                  disabled={!cursor || listLoading}
                  onClick={() => loadPackages({ append: true, nextQuery: query })}
                >
                  {loadMoreLabel}
                </Button>
              </Group>
            </Stack>
          </Box>
        </AppShell.Navbar>

        <AppShell.Main className="main-area">
          <Box className="main-content">
            {isAdmin && tokenManagementEnabled ? (
              <Accordion defaultValue={null} variant="separated" radius="md" className="token-accordion">
                <Accordion.Item value="tokens">
                  <Accordion.Control className="token-accordion-control">
                    <Group wrap="nowrap" gap={6}>
                      <Text className="token-accordion-title">Access Tokens</Text>
                      <Tooltip label={activeTokenSummary} withArrow position="top-start" openDelay={120} color="dark">
                        <Badge size="xs" variant="light" color="gray" className="token-accordion-count">
                          {activeTokenCount}
                        </Badge>
                      </Tooltip>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Group justify="space-between" mb="sm">
                      <Text size="xs" c="dimmed">Use Create/Edit to manage user token ACL.</Text>
                      <Button size="xs" onClick={() => { resetTokenForm(); setCreateTokenDialogOpen(true); }}>
                        Create
                      </Button>
                    </Group>
                    <ScrollArea>
                      <Table striped highlightOnHover className="token-table">
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>User</Table.Th>
                            <Table.Th>Token ID</Table.Th>
                            <Table.Th>Role</Table.Th>
                            <Table.Th>Read</Table.Th>
                            <Table.Th>Write</Table.Th>
                            <Table.Th>Created</Table.Th>
                            <Table.Th>Action</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {tokenItems.length ? tokenItems.map((item) => (
                            <Table.Tr key={item.token_id}>
                              <Table.Td><Text size="sm" className="token-cell-user">{item.username || '-'}</Text></Table.Td>
                              <Table.Td><Text className="token-id-text">{item.token_id || '-'}</Text></Table.Td>
                              <Table.Td><Text size="xs" className="token-role-text">{item.is_admin ? 'admin' : '-'}</Text></Table.Td>
                              <Table.Td>{renderAclCell(item.read)}</Table.Td>
                              <Table.Td>{renderAclCell(item.write)}</Table.Td>
                              <Table.Td><Text size="xs" c="dimmed">{formatDateTimeShort(item.created_at)}</Text></Table.Td>
                              <Table.Td>
                                <Group gap={4} wrap="nowrap" className="token-actions">
                                  <Button size="compact-xs" variant="subtle" color="gray" className="token-action-btn" onClick={() => onStartEditToken(item)}>
                                    Edit
                                  </Button>
                                  <Button
                                    size="compact-xs"
                                    variant="subtle"
                                    color="gray"
                                    className="token-action-btn token-action-rotate"
                                    onClick={() => onReissueToken(item)}
                                  >
                                    Rotate
                                  </Button>
                                  <Button size="compact-xs" variant="subtle" color="gray" className="token-action-btn token-action-delete" onClick={() => onDeleteToken(item)}>
                                    Delete
                                  </Button>
                                </Group>
                              </Table.Td>
                            </Table.Tr>
                          )) : (
                            <Table.Tr>
                              <Table.Td colSpan={7}><Text c="dimmed">No tokens.</Text></Table.Td>
                            </Table.Tr>
                          )}
                        </Table.Tbody>
                      </Table>
                    </ScrollArea>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            ) : null}

            <Paper className="panel detail-panel" p="md" radius="md">
              <Stack gap={5} mb="md" className="detail-head">
                <Title order={5}>Package Detail</Title>
                <Text size="sm" c="dimmed">
                  {currentPackage ? `Selected package: ${currentPackage}` : 'Select one package from the list.'}
                </Text>
              </Stack>

              <Tabs className="detail-tabs" value={detailTab} onChange={(value) => setDetailTab(value || 'versions')}>
                <Tabs.List>
                  <Tabs.Tab value="versions">Versions</Tabs.Tab>
                  <Tabs.Tab value="settings">Settings</Tabs.Tab>
                  <Tabs.Tab value="raw">Raw JSON</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="versions" pt="sm">
                  {currentPackage ? (
                    <Stack gap="sm">
                      <Paper className="inner-card install-card" p="sm" radius="sm">
                        <Group justify="space-between" align="flex-start" wrap="nowrap">
                          <Stack gap={2}>
                            <Text fw={600}>Install command</Text>
                            <Text size="xs" c="dimmed">Copy and run in your project.</Text>
                          </Stack>
                          <ActionIcon
                            variant="light"
                            color="gray"
                            aria-label="Copy install command"
                            title="Copy install command"
                            disabled={!installCommand}
                            onClick={() => copyInstallCommand(installCommand)}
                          >
                            <IconCopy size={16} />
                          </ActionIcon>
                        </Group>
                        <pre className="install-code">{installCommand || '# Select one package from the list.'}</pre>
                      </Paper>

                      <ScrollArea h={350}>
                        <Table striped highlightOnHover className="versions-table">
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Version</Table.Th>
                              <Table.Th>Dist-tags</Table.Th>
                              <Table.Th>Size</Table.Th>
                              <Table.Th>Published</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {versions.length ? versions.map((item) => {
                              const tags = versionTagMap.get(item.version) || [];
                              const publishedAbs = formatDateTimeShort(item.time);
                              return (
                                <Table.Tr key={item.version}>
                                  <Table.Td>
                                    <Text className="version-value">{item.version}</Text>
                                  </Table.Td>
                                  <Table.Td>
                                    <Group gap={4} wrap="wrap">
                                      {tags.length ? tags.map((tag) => (
                                        <Badge key={`${item.version}:${tag}`} variant="light" color={tag === 'latest' ? 'green' : 'gray'}>
                                          {tag}
                                        </Badge>
                                      )) : <Text size="xs" c="dimmed">-</Text>}
                                    </Group>
                                  </Table.Td>
                                  <Table.Td><Text size="xs" className="version-size">{formatBytes(item.size)}</Text></Table.Td>
                                  <Table.Td><Text size="xs" className="version-published">{publishedAbs}</Text></Table.Td>
                                </Table.Tr>
                              );
                            }) : (
                              <Table.Tr>
                                <Table.Td colSpan={4}><Text c="dimmed">No versions.</Text></Table.Td>
                              </Table.Tr>
                            )}
                          </Table.Tbody>
                        </Table>
                      </ScrollArea>
                    </Stack>
                  ) : (
                    <Text c="dimmed">Select one package from the list.</Text>
                  )}
                </Tabs.Panel>

                <Tabs.Panel value="settings" pt="sm">
                  {currentPackage ? (
                    <Stack gap="sm">
                      <Paper className="inner-card" p="sm" radius="sm">
                        <Group justify="space-between" mb={6} wrap="nowrap">
                          <Text fw={600}>Dist-tag</Text>
                          <Popover
                            width={320}
                            position="top-end"
                            withArrow
                            shadow="md"
                            opened={distTagHelpOpen}
                            onChange={setDistTagHelpOpen}
                          >
                            <Popover.Target>
                              <ActionIcon
                                variant="light"
                                color="gray"
                                aria-label="About dist-tags"
                                onMouseEnter={openDistTagHelp}
                                onMouseLeave={closeDistTagHelpSoon}
                                onFocus={openDistTagHelp}
                                onBlur={closeDistTagHelpSoon}
                                onClick={(event) => {
                                  event.preventDefault();
                                  toggleDistTagHelp();
                                }}
                              >
                                <IconInfoCircle size={16} />
                              </ActionIcon>
                            </Popover.Target>
                            <Popover.Dropdown onMouseEnter={openDistTagHelp} onMouseLeave={closeDistTagHelpSoon}>
                              <Text size="sm" fw={600} mb={4}>Dist-tag behavior</Text>
                              <Text size="xs" c="dimmed">Alias only: map latest/next/beta/rc to an existing version.</Text>
                              <Text size="xs" c="dimmed">Tag name is unique per package. Setting rc again replaces previous rc target.</Text>
                            </Popover.Dropdown>
                          </Popover>
                        </Group>
                        <Text size="xs" c="dimmed" mb="sm">Tag maps an install channel to one version in this package.</Text>

                        <Group className="dist-tag-row" align="end" wrap="nowrap">
                          <TextInput
                            value={tagName}
                            onChange={(event) => setTagName(event.target.value)}
                            placeholder="dist-tag (e.g. latest)"
                          />
                          <Select
                            value={tagVersion || null}
                            onChange={(value) => setTagVersion(value || '')}
                            placeholder={versions.length ? 'Version' : 'No versions'}
                            data={versionSelectData}
                            disabled={!versions.length}
                            searchable
                          />
                          <Button
                            variant="light"
                            color="blue"
                            onClick={onSetDistTag}
                            disabled={!currentPackage || !tagVersion}
                            leftSection={<IconCheck size={14} />}
                          >
                            Set dist-tag
                          </Button>
                        </Group>
                      </Paper>

                      <Paper className="inner-card danger-card" p="sm" radius="sm">
                        <Stack gap={4}>
                          <Text fw={600}>Danger Zone</Text>
                          <Text size="xs" c="dimmed">High-risk operation. Delete metadata and tarball permanently.</Text>
                        </Stack>
                        <Divider my="sm" />
                        <Group align="end" wrap="nowrap">
                          <Select
                            value={deleteVersion || null}
                            onChange={(value) => setDeleteVersion(value || '')}
                            placeholder={versions.length ? 'Version' : 'No versions'}
                            data={versionSelectData}
                            disabled={!versions.length}
                            searchable
                            className="delete-version-select"
                          />
                          <Button
                            variant="light"
                            color="red"
                            onClick={() => setDeleteVersionDialogOpen(true)}
                            disabled={!currentPackage || !deleteVersion}
                            leftSection={<IconTrash size={14} />}
                          >
                            Delete version
                          </Button>
                        </Group>
                      </Paper>
                    </Stack>
                  ) : (
                    <Text c="dimmed">Select one package from the list.</Text>
                  )}
                </Tabs.Panel>

                <Tabs.Panel value="raw" pt="sm">
                  <ScrollArea h={520} className="json-scroll-wrap">
                    <pre className="json-pre">{detailJson}</pre>
                  </ScrollArea>
                </Tabs.Panel>
              </Tabs>
            </Paper>
          </Box>
        </AppShell.Main>
      </AppShell>

      <Modal
        opened={createTokenDialogOpen}
        onClose={resetTokenForm}
        title="Create access"
        size="lg"
        centered
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">Create a token for one user with read/write ACL.</Text>
          <Box className="token-form-grid">
            <TextInput
              label="User"
              value={tokenUsernameInput}
              onChange={(event) => setTokenUsernameInput(event.target.value)}
              disabled={!isAdmin}
              placeholder="e.g. alice"
            />
            <TextInput
              label="Read"
              value={tokenReadInput}
              onChange={(event) => setTokenReadInput(event.target.value)}
              disabled={isCreateAdminRoleToken}
              placeholder={isCreateAdminRoleToken ? 'auto: *' : 'e.g. @team/*,team-*'}
            />
            <TextInput
              label="Write"
              value={tokenWriteInput}
              onChange={(event) => setTokenWriteInput(event.target.value)}
              disabled={isCreateAdminRoleToken}
              placeholder={isCreateAdminRoleToken ? 'auto: *' : 'e.g. @team/pkg-a,@team/*'}
            />
            <Box>
              <Group gap={6} mb={4}>
                <Text size="sm">Role</Text>
                <Popover width={260} withArrow shadow="md">
                  <Popover.Target>
                    <ActionIcon variant="subtle" color="gray" size="sm" aria-label="About admin role">
                      <IconInfoCircle size={14} />
                    </ActionIcon>
                  </Popover.Target>
                  <Popover.Dropdown>
                    <Text size="sm" fw={600} mb={4}>Admin role</Text>
                    <Text size="xs" c="dimmed">Can manage users and tokens.</Text>
                    <Text size="xs" c="dimmed">Always grants read/write for all packages.</Text>
                  </Popover.Dropdown>
                </Popover>
              </Group>
              <Checkbox
                label="Admin"
                checked={tokenAdminInput}
                onChange={(event) => setTokenAdminInput(event.currentTarget.checked)}
              />
            </Box>
          </Box>

          <Text size="xs" c="dimmed">Rules are comma-separated, e.g. `@team/*, team-*`.</Text>

          <Group justify="flex-end">
            <Button variant="default" color="gray" onClick={resetTokenForm}>Cancel</Button>
            <Button onClick={onCreateToken}>Save</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={editTokenDialogOpen}
        onClose={resetEditTokenForm}
        title="Edit access"
        size="lg"
        centered
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">Update read/write rules and role for selected token.</Text>
          <Box className="token-form-grid">
            <TextInput label="User" value={editTokenUsername} disabled />
            <TextInput
              label="Read"
              value={editTokenReadInput}
              onChange={(event) => setEditTokenReadInput(event.target.value)}
              disabled={isEditAdminRoleToken}
              placeholder={isEditAdminRoleToken ? 'auto: *' : 'e.g. @team/*,team-*'}
            />
            <TextInput
              label="Write"
              value={editTokenWriteInput}
              onChange={(event) => setEditTokenWriteInput(event.target.value)}
              disabled={isEditAdminRoleToken}
              placeholder={isEditAdminRoleToken ? 'auto: *' : 'e.g. @team/pkg-a,@team/*'}
            />
            <Box>
              <Group gap={6} mb={4}>
                <Text size="sm">Role</Text>
                <Popover width={260} withArrow shadow="md">
                  <Popover.Target>
                    <ActionIcon variant="subtle" color="gray" size="sm" aria-label="About admin role">
                      <IconInfoCircle size={14} />
                    </ActionIcon>
                  </Popover.Target>
                  <Popover.Dropdown>
                    <Text size="sm" fw={600} mb={4}>Admin role</Text>
                    <Text size="xs" c="dimmed">Can manage users and tokens.</Text>
                    <Text size="xs" c="dimmed">Always grants read/write for all packages.</Text>
                  </Popover.Dropdown>
                </Popover>
              </Group>
              <Checkbox
                label="Admin"
                checked={editTokenAdminInput}
                onChange={(event) => setEditTokenAdminInput(event.currentTarget.checked)}
              />
            </Box>
          </Box>

          <Text size="xs" c="dimmed">Rules are comma-separated, e.g. `@team/*, team-*`.</Text>

          <Group justify="flex-end">
            <Button variant="default" color="gray" onClick={resetEditTokenForm}>Cancel</Button>
            <Button onClick={onSaveEditToken}>Save</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={tokenDialogOpen}
        onClose={() => {
          setTokenDialogOpen(false);
          setShowCreatedToken(false);
          setCreatedToken('');
        }}
        title="New token (shown once)"
        centered
        closeOnClickOutside={false}
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">Copy now. After close, token will not be shown again.</Text>
          <Code block className="token-secret-block">
            {showCreatedToken ? createdToken : maskTokenValue(createdToken)}
          </Code>
          <Group justify="flex-end">
            <Button variant="default" color="gray" onClick={() => setShowCreatedToken((prev) => !prev)}>
              {showCreatedToken ? 'Hide' : 'Show'}
            </Button>
            <Button color="green" leftSection={<IconCopy size={14} />} onClick={copyCreatedToken}>Copy</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={deleteTokenDialogOpen}
        onClose={() => {
          setDeleteTokenDialogOpen(false);
          setPendingDeleteToken(null);
        }}
        title="Delete token"
        centered
      >
        <Stack gap="sm">
          <Text size="sm">
            Delete token for user <Code>{pendingDeleteToken?.username || '-'}</Code>? This action cannot be undone.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" color="gray" onClick={() => {
              setDeleteTokenDialogOpen(false);
              setPendingDeleteToken(null);
            }}>
              Cancel
            </Button>
            <Button color="red" leftSection={<IconTrash size={14} />} onClick={onConfirmDeleteToken}>
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={rotateTokenDialogOpen}
        onClose={() => {
          setRotateTokenDialogOpen(false);
          setPendingRotateToken(null);
        }}
        title="Rotate token"
        centered
      >
        <Stack gap="sm">
          <Text size="sm">
            Rotate token for user <Code>{pendingRotateToken?.username || '-'}</Code>? A new token will be generated and old token becomes invalid immediately.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" color="gray" onClick={() => {
              setRotateTokenDialogOpen(false);
              setPendingRotateToken(null);
            }}>
              Cancel
            </Button>
            <Button color="yellow" leftSection={<IconRotateClockwise size={14} />} onClick={onConfirmRotateToken}>
              Rotate
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={deleteVersionDialogOpen}
        onClose={() => setDeleteVersionDialogOpen(false)}
        title="Delete version"
        centered
      >
        <Stack gap="sm">
          <Text size="sm">
            Delete version <Code>{deleteVersion || '-'}</Code> from <Code>{currentPackage || '-'}</Code>? This will remove metadata and tarball.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" color="gray" onClick={() => setDeleteVersionDialogOpen(false)}>
              Cancel
            </Button>
            <Button color="red" leftSection={<IconTrash size={14} />} onClick={onDeleteVersion}>
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </MantineProvider>
  );
}

const mount = document.getElementById('app');
if (mount) {
  createRoot(mount).render(<App />);
}
