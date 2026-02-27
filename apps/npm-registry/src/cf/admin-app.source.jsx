import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Toast from '@radix-ui/react-toast';
import {
  Theme,
  Card,
  Heading,
  Flex,
  Text,
  Code,
  IconButton,
  Button,
  TextField,
  Badge,
  Table,
  Select,
  Checkbox,
  ScrollArea,
  AlertDialog,
  Dialog,
  Popover
} from '@radix-ui/themes';
import { Cross2Icon, InfoCircledIcon } from '@radix-ui/react-icons';
import '@radix-ui/themes/styles.css';
import './admin-app.css';

const PAGE_SIZE = 100;

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

function formatTime(raw) {
  const value = String(raw || '').trim();
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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

function App() {
  const [whoami, setWhoami] = useState('-');
  const [isAdmin, setIsAdmin] = useState(false);
  const [authSource, setAuthSource] = useState('env');
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
  const [tagName, setTagName] = useState('latest');
  const [tagVersion, setTagVersion] = useState('');
  const [deleteVersion, setDeleteVersion] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [tagInfoOpen, setTagInfoOpen] = useState(false);
  const [adminRoleInfoOpen, setAdminRoleInfoOpen] = useState(false);
  const [editAdminRoleInfoOpen, setEditAdminRoleInfoOpen] = useState(false);
  const [tokenItems, setTokenItems] = useState([]);
  const [tokenUsernameInput, setTokenUsernameInput] = useState('');
  const [tokenReadInput, setTokenReadInput] = useState('');
  const [tokenWriteInput, setTokenWriteInput] = useState('');
  const [tokenAdminInput, setTokenAdminInput] = useState(false);
  const [editTokenDialogOpen, setEditTokenDialogOpen] = useState(false);
  const [editTokenId, setEditTokenId] = useState('');
  const [editTokenUsername, setEditTokenUsername] = useState('');
  const [editTokenReadInput, setEditTokenReadInput] = useState('');
  const [editTokenWriteInput, setEditTokenWriteInput] = useState('');
  const [editTokenAdminInput, setEditTokenAdminInput] = useState(false);
  const [createdToken, setCreatedToken] = useState('');
  const [showCreatedToken, setShowCreatedToken] = useState(false);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [toast, setToast] = useState({
    open: false,
    message: '',
    kind: 'info'
  });

  const listRequestSeqRef = useRef(0);
  const packageMapRef = useRef(new Map());
  const isCreateAdminRoleToken = isAdmin && tokenAdminInput;
  const isEditAdminRoleToken = isAdmin && editTokenAdminInput;

  const showToast = useCallback((message, kind = 'info') => {
    setToast({
      open: true,
      message: String(message || ''),
      kind
    });
  }, []);

  const resetTokenForm = useCallback(() => {
    setTokenUsernameInput('');
    setTokenReadInput('');
    setTokenWriteInput('');
    setTokenAdminInput(false);
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
      const username = String(data?.username || '-');
      setWhoami(username);
      setIsAdmin(Boolean(data?.is_admin));
      const source = String(data?.auth_source || 'env');
      setAuthSource(source);
      setTokenManagementEnabled(Boolean(data?.token_management));
      resetTokenForm();
      resetEditTokenForm();
    } catch (err) {
      setWhoami('-');
      setIsAdmin(false);
      setAuthSource('env');
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
        body: JSON.stringify({
          name: currentPackage,
          tag,
          version
        })
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
        body: JSON.stringify({
          name: currentPackage,
          version
        })
      });
      await loadPackageDetail(currentPackage);
      await loadPackages({ append: false, nextQuery: query });
      setDeleteDialogOpen(false);
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

  const onEditTokenDialogOpenChange = useCallback((open) => {
    setEditTokenDialogOpen(open);
    if (!open) {
      setEditAdminRoleInfoOpen(false);
      resetEditTokenForm();
    }
  }, [resetEditTokenForm]);

  const onTokenDialogOpenChange = useCallback((open) => {
    setTokenDialogOpen(open);
    if (!open) {
      setShowCreatedToken(false);
      setCreatedToken('');
    }
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
      setTokenReadInput('');
      setTokenWriteInput('');
      setTokenAdminInput(false);
      showToast('Token created', 'success');
    } catch (err) {
      showToast('Create token failed: ' + err.message, 'error');
    }
  }, [
    isCreateAdminRoleToken,
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
      setEditAdminRoleInfoOpen(false);
      resetEditTokenForm();
      showToast('Token updated', 'success');
    } catch (err) {
      showToast('Update token failed: ' + err.message, 'error');
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

  const onDeleteToken = useCallback(async (item) => {
    const tokenId = String(item?.token_id || '').trim();
    const username = String(item?.username || '').trim();
    if (!tokenId) return;
    const promptUser = username || 'unknown-user';
    const sure = globalThis.confirm(`Delete token for user "${promptUser}"?`);
    if (!sure) return;
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
      showToast(`Token deleted for ${promptUser}`, 'success');
    } catch (err) {
      showToast('Delete token failed: ' + err.message, 'error');
    }
  }, [editTokenId, resetEditTokenForm, showToast]);

  const onReissueToken = useCallback(async (item) => {
    const tokenId = String(item?.token_id || '').trim();
    const username = String(item?.username || '').trim();
    if (!tokenId) return;
    const promptUser = username || 'unknown-user';
      const sure = globalThis.confirm(
        `Rotate token for user "${promptUser}"?\nThis will generate a new token and invalidate the old token immediately.`
      );
    if (!sure) return;
    try {
      const data = await fetchJson('/_/api/admin/token-rotate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token_id: tokenId,
          replace_old: true
        })
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
      const token = String(data?.token || '');
      setCreatedToken(token);
      setShowCreatedToken(false);
      setTokenDialogOpen(true);
      showToast(`New token generated for ${promptUser}`, 'success');
    } catch (err) {
      showToast('Rotate token failed: ' + err.message, 'error');
    }
  }, [editTokenId, resetEditTokenForm, showToast]);

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

  const stats = useMemo(() => {
    const total =
      Number.isFinite(totalVisible)
        ? String(totalVisible) + (totalExact ? '' : '+')
        : '?';
    const scope = query ? 'Query: "' + query + '"' : 'All packages';
    return {
      scope,
      loaded: String(packages.length),
      total,
      pageSize: String(PAGE_SIZE)
    };
  }, [packages.length, query, totalExact, totalVisible]);

  const loadMoreLabel = useMemo(() => {
    if (listLoading) return 'Loading...';
    if (cursor) return 'Load next ' + PAGE_SIZE;
    if (packages.length) return 'All loaded';
    return 'No results';
  }, [cursor, listLoading, packages.length]);

  const detailJson = useMemo(() => JSON.stringify(detail || {}, null, 2), [detail]);
  const versions = Array.isArray(detail?.versions) ? detail.versions : [];

  useEffect(() => {
    loadWhoAmI();
    loadPackages({
      append: false,
      nextQuery: ''
    });
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
      loadPackages({
        append: false,
        nextQuery: next
      });
    }, 240);
    return () => clearTimeout(timer);
  }, [loadPackages, query, queryInput]);

  return (
    <Theme appearance="dark" accentColor="blue" grayColor="slate" radius="medium">
      <Toast.Provider swipeDirection="right">
      <div className="app-wrap">
        <Card size="3">
          <Flex justify="between" align="center" gap="3" wrap="wrap">
            <Flex align="center" gap="2" wrap="wrap">
              <Heading size="6">NPM Registry Admin</Heading>
              <Badge variant="soft" color="gray">user: {whoami}</Badge>
              <Badge variant="soft" color="gray">auth: {authSource}</Badge>
            </Flex>
            <Button
              variant="soft"
              color="gray"
              disabled={listLoading}
              onClick={() => {
                loadPackages({
                  append: false,
                  nextQuery: query
                });
              }}
            >
              {listLoading ? 'Refreshing...' : 'Refresh packages'}
            </Button>
          </Flex>
        </Card>

        {isAdmin && tokenManagementEnabled
          ? (
            <Card size="3">
              <Heading size="4" mb="3">Access Tokens</Heading>
              <>
                <Flex className="token-form-header">
                  <Flex align="center" gap="2" wrap="wrap">
                    <Badge variant="soft" color="blue" className="token-mode-badge">Create token</Badge>
                    <Text size="1" color="gray">Use Edit in table to modify an existing token.</Text>
                  </Flex>
                </Flex>

                <div className="token-grid" style={{ marginBottom: 8 }}>
                  <Flex direction="column" gap="1" className="token-field">
                    <Text size="1" color="gray">User</Text>
                    <TextField.Root
                      value={tokenUsernameInput}
                      onChange={(event) => setTokenUsernameInput(event.target.value)}
                      disabled={!isAdmin}
                      placeholder="e.g. alice"
                    />
                  </Flex>
                  <Flex direction="column" gap="1" className="token-field">
                    <Text size="1" color="gray">Read</Text>
                    <TextField.Root
                      value={tokenReadInput}
                      onChange={(event) => setTokenReadInput(event.target.value)}
                      className={isCreateAdminRoleToken ? 'input-disabled' : ''}
                      disabled={isCreateAdminRoleToken}
                      title={isCreateAdminRoleToken ? 'Ignored when Admin is enabled.' : ''}
                      placeholder={isCreateAdminRoleToken ? 'auto: *' : 'e.g. @team/*,team-*'}
                    />
                  </Flex>
                  <Flex direction="column" gap="1" className="token-field">
                    <Text size="1" color="gray">Write</Text>
                    <TextField.Root
                      value={tokenWriteInput}
                      onChange={(event) => setTokenWriteInput(event.target.value)}
                      className={isCreateAdminRoleToken ? 'input-disabled' : ''}
                      disabled={isCreateAdminRoleToken}
                      title={isCreateAdminRoleToken ? 'Ignored when Admin is enabled.' : ''}
                      placeholder={isCreateAdminRoleToken ? 'auto: *' : 'e.g. @team/pkg-a,@team/*'}
                    />
                  </Flex>
                  <Flex direction="column" gap="1" className="token-field token-check">
                    <Text size="1" color="gray">Role</Text>
                    <Flex className="token-role-inline">
                      <Checkbox
                        checked={tokenAdminInput}
                        onCheckedChange={(checked) => setTokenAdminInput(checked === true)}
                        aria-label="Admin"
                      />
                      <Text size="1" color="gray">Admin</Text>
                      <Popover.Root open={adminRoleInfoOpen} onOpenChange={setAdminRoleInfoOpen}>
                        <Flex
                          align="center"
                          gap="1"
                          onMouseEnter={() => setAdminRoleInfoOpen(true)}
                          onMouseLeave={() => setAdminRoleInfoOpen(false)}
                        >
                          <Popover.Trigger asChild>
                            <IconButton
                              type="button"
                              variant="soft"
                              color="gray"
                              radius="full"
                              className="mini-info-icon-btn"
                              aria-label="About admin role"
                            >
                              <InfoCircledIcon />
                            </IconButton>
                          </Popover.Trigger>
                          <Popover.Content
                            className="popover-content"
                            side="top"
                            align="start"
                            sideOffset={8}
                          >
                            <Text size="2" weight="bold" mb="1">Admin role</Text>
                            <ul className="popover-list">
                              <li>Can manage users and tokens.</li>
                              <li>Always grants read/write for all packages.</li>
                            </ul>
                          </Popover.Content>
                        </Flex>
                      </Popover.Root>
                    </Flex>
                  </Flex>
                  <Flex direction="column" gap="1" className="token-field token-actions">
                    <Text size="1" color="gray">Action</Text>
                    <Button className="token-create-btn" onClick={onCreateToken}>Create token</Button>
                  </Flex>
                </div>
                <Text size="1" color="gray" className="token-form-hint">
                  Rules are comma-separated, e.g. `@team/*, team-*`.
                </Text>

                <Table.Root variant="surface">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>User</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Token ID</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Role</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Read</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Write</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Created</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Action</Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {tokenItems.length
                      ? tokenItems.map((item) => (
                          <Table.Row key={item.token_id}>
                            <Table.Cell><Text as="span" className="code">{item.username || '-'}</Text></Table.Cell>
                            <Table.Cell><Text as="span" className="code">{item.token_id}</Text></Table.Cell>
                            <Table.Cell><Text as="span" className="code">{item.is_admin ? 'admin' : '-'}</Text></Table.Cell>
                            <Table.Cell><Text as="span" className="code">{Array.isArray(item.read) ? item.read.join(', ') || '-' : '-'}</Text></Table.Cell>
                            <Table.Cell><Text as="span" className="code">{Array.isArray(item.write) ? item.write.join(', ') || '-' : '-'}</Text></Table.Cell>
                            <Table.Cell><Text size="1" color="gray">{formatTime(item.created_at)}</Text></Table.Cell>
                            <Table.Cell className="token-action-cell">
                              <Button
                                variant="soft"
                                color="gray"
                                onClick={() => onStartEditToken(item)}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="soft"
                                color="amber"
                                onClick={() => onReissueToken(item)}
                              >
                                Rotate
                              </Button>
                              <Button
                                color="red"
                                onClick={() => onDeleteToken(item)}
                              >
                                Delete
                              </Button>
                            </Table.Cell>
                          </Table.Row>
                        ))
                      : (
                        <Table.Row>
                          <Table.Cell colSpan={7}><Text color="gray">No tokens.</Text></Table.Cell>
                        </Table.Row>
                      )}
                  </Table.Body>
                </Table.Root>
              </>
            </Card>
          )
          : null}

        <section className="grid">
          <Card size="3">
            <Heading size="4" mb="3">Packages</Heading>
            <Flex gap="2" wrap="wrap" mb="2">
              <TextField.Root
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
                placeholder="Search package (contains)"
              />
              <Button
                variant="soft"
                color="gray"
                onClick={() => {
                  setQueryInput('');
                  loadPackages({
                    append: false,
                    nextQuery: ''
                  });
                }}
              >
                Clear
              </Button>
            </Flex>
            <div className="stats-row" style={{ marginBottom: 8 }}>
              <Badge variant="soft" color="gray" className="stat-badge stat-scope">
                <Text size="1" color="gray">Scope</Text>
                <Text as="span" size="1">{stats.scope}</Text>
              </Badge>
              <Badge variant="soft" color="gray" className="stat-badge">
                <Text size="1" color="gray">Loaded</Text>
                <Text as="span" size="1">{stats.loaded}</Text>
              </Badge>
              <Badge variant="soft" color="gray" className="stat-badge">
                <Text size="1" color="gray">Total</Text>
                <Text as="span" size="1">{stats.total}</Text>
              </Badge>
              <Badge variant="soft" color="gray" className="stat-badge">
                <Text size="1" color="gray">Per page</Text>
                <Text as="span" size="1">{stats.pageSize}</Text>
              </Badge>
            </div>
            <Table.Root variant="surface">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell className="pkg-col">Package</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="latest-col">Latest</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="versions-col">Versions</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="updated-col">Updated</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {packages.length
                  ? packages.map((item) => (
                      <Table.Row key={item.name}>
                        <Table.Cell>
                          <Button
                            variant="ghost"
                            color="gray"
                            className="code pkg-btn"
                            title={item.name || ''}
                            onClick={() => loadPackageDetail(item.name)}
                          >
                            {item.name || ''}
                          </Button>
                        </Table.Cell>
                        <Table.Cell><Text as="span" className="code">{item.latest || '-'}</Text></Table.Cell>
                        <Table.Cell>{item.version_count || 0}</Table.Cell>
                        <Table.Cell title={item.modified || ''}><Text size="1" color="gray" className="time-cell">{formatTime(item.modified)}</Text></Table.Cell>
                      </Table.Row>
                    ))
                  : (
                    <Table.Row>
                      <Table.Cell colSpan={4}><Text color="gray">No package found.</Text></Table.Cell>
                    </Table.Row>
                  )}
              </Table.Body>
            </Table.Root>
            <Flex mt="3">
              <Button
                variant="soft"
                color="gray"
                disabled={!cursor || listLoading}
                onClick={() => {
                  loadPackages({
                    append: true,
                    nextQuery: query
                  });
                }}
              >
                {loadMoreLabel}
              </Button>
            </Flex>
          </Card>

          <Card size="3">
            <Heading size="4" mb="3">Package Detail</Heading>
            <Text color="gray">{currentPackage ? 'Package: ' + currentPackage : 'Select one package from the list.'}</Text>

            <Flex direction="column" gap="3" mt="3">
              <Card variant="surface">
                <Flex align="center" justify="between" gap="2" wrap="wrap">
                  <Heading size="2">Dist-tag</Heading>
                  <Popover.Root open={tagInfoOpen} onOpenChange={setTagInfoOpen}>
                    <Flex
                      align="center"
                      gap="1"
                      onMouseEnter={() => setTagInfoOpen(true)}
                      onMouseLeave={() => setTagInfoOpen(false)}
                    >
                      <Popover.Trigger asChild>
                        <IconButton
                          type="button"
                          variant="soft"
                          color="gray"
                          radius="full"
                          className="info-icon-btn"
                          aria-label="About dist-tags"
                        >
                          <InfoCircledIcon />
                        </IconButton>
                      </Popover.Trigger>
                      <Popover.Content
                        className="popover-content"
                        side="top"
                        align="start"
                        sideOffset={8}
                      >
                        <Text size="2" weight="bold" mb="1">Dist-tag behavior</Text>
                        <ul className="popover-list">
                          <li>Alias only: map latest/next/beta/rc to an existing version.</li>
                          <li>Tag name is unique per package. Setting rc again replaces previous rc target.</li>
                        </ul>
                      </Popover.Content>
                    </Flex>
                  </Popover.Root>
                </Flex>
                <Text size="1" color="gray" mt="1">Tag maps an install channel to one version in this package.</Text>
                <div className="dist-tag-row">
                  <TextField.Root
                    value={tagName}
                    onChange={(event) => setTagName(event.target.value)}
                    placeholder="dist-tag (e.g. latest)"
                  />
                  <Select.Root
                    value={tagVersion}
                    onValueChange={setTagVersion}
                    disabled={!versions.length}
                  >
                    <Select.Trigger placeholder={versions.length ? 'Version' : 'No versions'} />
                    <Select.Content>
                      {versions.map((item) => (
                        <Select.Item key={item.version} value={item.version}>{item.version}</Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                  <Button onClick={onSetDistTag} disabled={!currentPackage || !tagVersion}>Set dist-tag</Button>
                </div>
              </Card>

              <Card variant="surface" className="danger-card">
                <Heading size="2">Delete version</Heading>
                <Text size="1" color="gray" mt="1">Delete metadata and tarball object for one version.</Text>
                <Flex gap="2" wrap="wrap" mt="2">
                  <Select.Root
                    value={deleteVersion}
                    onValueChange={setDeleteVersion}
                    disabled={!versions.length}
                  >
                    <Select.Trigger placeholder={versions.length ? 'Version' : 'No versions'} />
                    <Select.Content>
                      {versions.map((item) => (
                        <Select.Item key={item.version} value={item.version}>{item.version}</Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                  <AlertDialog.Root open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                    <AlertDialog.Trigger asChild>
                      <Button color="red" disabled={!currentPackage || !deleteVersion}>Delete version</Button>
                    </AlertDialog.Trigger>
                    <AlertDialog.Content maxWidth="460px">
                      <AlertDialog.Title>Delete Version</AlertDialog.Title>
                      <AlertDialog.Description>
                        Delete version <Code>{deleteVersion || '-'}</Code> from <Code>{currentPackage || '-'}</Code>?
                        {' '}
                        This will remove both metadata and tarball object.
                      </AlertDialog.Description>
                      <Flex mt="4" justify="end" gap="2">
                        <AlertDialog.Cancel asChild>
                          <Button variant="soft" color="gray">Cancel</Button>
                        </AlertDialog.Cancel>
                        <Button color="red" onClick={onDeleteVersion}>Delete</Button>
                      </Flex>
                    </AlertDialog.Content>
                  </AlertDialog.Root>
                </Flex>
              </Card>
            </Flex>

            <div style={{ marginTop: 10 }}>
              <ScrollArea type="always" scrollbars="both" className="json-scroll-root">
                <pre className="code json-pre">{detailJson}</pre>
              </ScrollArea>
            </div>
          </Card>
        </section>
      </div>

      <Dialog.Root open={editTokenDialogOpen} onOpenChange={onEditTokenDialogOpenChange}>
        <Dialog.Content maxWidth="760px">
          <Flex align="center" justify="between" gap="2">
            <Dialog.Title>Edit token</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton
                variant="soft"
                color="gray"
                radius="full"
                className="icon-close-btn"
                aria-label="Close edit token dialog"
              >
                <Cross2Icon />
              </IconButton>
            </Dialog.Close>
          </Flex>
          <Dialog.Description asChild>
            <Text size="2" color="gray" mt="2">
              Update ACL and role for selected token.
            </Text>
          </Dialog.Description>

          <div className="token-grid" style={{ marginTop: 12 }}>
            <Flex direction="column" gap="1" className="token-field">
              <Text size="1" color="gray">User</Text>
              <TextField.Root
                value={editTokenUsername}
                className="input-disabled"
                disabled
              />
            </Flex>
            <Flex direction="column" gap="1" className="token-field">
              <Text size="1" color="gray">Read</Text>
              <TextField.Root
                value={editTokenReadInput}
                onChange={(event) => setEditTokenReadInput(event.target.value)}
                className={isEditAdminRoleToken ? 'input-disabled' : ''}
                disabled={isEditAdminRoleToken}
                title={isEditAdminRoleToken ? 'Ignored when Admin is enabled.' : ''}
                placeholder={isEditAdminRoleToken ? 'auto: *' : 'e.g. @team/*,team-*'}
              />
            </Flex>
            <Flex direction="column" gap="1" className="token-field">
              <Text size="1" color="gray">Write</Text>
              <TextField.Root
                value={editTokenWriteInput}
                onChange={(event) => setEditTokenWriteInput(event.target.value)}
                className={isEditAdminRoleToken ? 'input-disabled' : ''}
                disabled={isEditAdminRoleToken}
                title={isEditAdminRoleToken ? 'Ignored when Admin is enabled.' : ''}
                placeholder={isEditAdminRoleToken ? 'auto: *' : 'e.g. @team/pkg-a,@team/*'}
              />
            </Flex>
            <Flex direction="column" gap="1" className="token-field token-check">
              <Text size="1" color="gray">Role</Text>
              <Flex className="token-role-inline">
                <Checkbox
                  checked={editTokenAdminInput}
                  onCheckedChange={(checked) => setEditTokenAdminInput(checked === true)}
                  aria-label="Admin"
                />
                <Text size="1" color="gray">Admin</Text>
                <Popover.Root open={editAdminRoleInfoOpen} onOpenChange={setEditAdminRoleInfoOpen}>
                  <Flex
                    align="center"
                    gap="1"
                    onMouseEnter={() => setEditAdminRoleInfoOpen(true)}
                    onMouseLeave={() => setEditAdminRoleInfoOpen(false)}
                  >
                    <Popover.Trigger asChild>
                      <IconButton
                        type="button"
                        variant="soft"
                        color="gray"
                        radius="full"
                        className="mini-info-icon-btn"
                        aria-label="About admin role"
                      >
                        <InfoCircledIcon />
                      </IconButton>
                    </Popover.Trigger>
                    <Popover.Content
                      className="popover-content"
                      side="top"
                      align="start"
                      sideOffset={8}
                    >
                      <Text size="2" weight="bold" mb="1">Admin role</Text>
                      <ul className="popover-list">
                        <li>Can manage users and tokens.</li>
                        <li>Always grants read/write for all packages.</li>
                      </ul>
                    </Popover.Content>
                  </Flex>
                </Popover.Root>
              </Flex>
            </Flex>
          </div>

          <Text size="1" color="gray" className="token-form-hint" mt="2">
            Rules are comma-separated, e.g. `@team/*, team-*`.
          </Text>
          <Flex mt="3" justify="end" gap="2">
            <Dialog.Close asChild>
              <Button variant="soft" color="gray">Cancel</Button>
            </Dialog.Close>
            <Button onClick={onSaveEditToken}>Save token</Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={tokenDialogOpen} onOpenChange={onTokenDialogOpenChange}>
        <Dialog.Content
          maxWidth="760px"
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <Flex align="center" justify="between" gap="2">
            <Dialog.Title>New token (shown once)</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton
                variant="soft"
                color="gray"
                radius="full"
                className="icon-close-btn"
                aria-label="Close token dialog"
              >
                <Cross2Icon />
              </IconButton>
            </Dialog.Close>
          </Flex>
          <Dialog.Description asChild>
            <Text size="2" color="gray" mt="2">
            Copy now. After close, token will not be shown again.
            </Text>
          </Dialog.Description>
          <div className="token-modal-value-row">
            <code className="token-secret token-secret-full">
              {showCreatedToken ? createdToken : maskTokenValue(createdToken)}
            </code>
          </div>
          <Flex className="token-modal-actions">
            <Button
              variant="soft"
              color="gray"
              onClick={() => setShowCreatedToken((prev) => !prev)}
            >
              {showCreatedToken ? 'Hide' : 'Show'}
            </Button>
            <Button color="green" onClick={copyCreatedToken}>Copy</Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      <Toast.Root
        open={toast.open}
        onOpenChange={(open) => setToast((prev) => ({ ...prev, open }))}
        className={'toast ' + (toast.kind || 'info')}
        duration={2200}
      >
        <Toast.Title>{toast.message}</Toast.Title>
      </Toast.Root>
      <Toast.Viewport className="toast-viewport" />
      </Toast.Provider>
    </Theme>
  );
}

const mount = document.getElementById('app');
if (mount) {
  createRoot(mount).render(<App />);
}
