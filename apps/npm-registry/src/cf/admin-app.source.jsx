import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Toast from '@radix-ui/react-toast';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import * as Popover from '@radix-ui/react-popover';
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

function App() {
  const [whoami, setWhoami] = useState('-');
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
  const [toast, setToast] = useState({
    open: false,
    message: '',
    kind: 'info'
  });

  const listRequestSeqRef = useRef(0);
  const packageMapRef = useRef(new Map());

  const showToast = useCallback((message, kind = 'info') => {
    setToast({
      open: true,
      message: String(message || ''),
      kind
    });
  }, []);

  const loadWhoAmI = useCallback(async () => {
    try {
      const data = await fetchJson('/_/api/admin/whoami');
      setWhoami(data?.username || '-');
    } catch (err) {
      setWhoami('-');
      showToast('Whoami failed: ' + err.message, 'error');
    }
  }, [showToast]);

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
    <Toast.Provider swipeDirection="right">
      <div className="app-wrap">
        <section className="panel">
          <div className="topbar">
            <div className="row">
              <h1 className="title">NPM Registry Admin</h1>
              <span className="badge muted">user: {whoami}</span>
            </div>
            <div className="row">
              <button
                className="secondary"
                disabled={listLoading}
                onClick={() => {
                  loadPackages({
                    append: false,
                    nextQuery: query
                  });
                }}
              >
                {listLoading ? 'Refreshing...' : 'Refresh packages'}
              </button>
            </div>
          </div>
        </section>

        <section className="grid">
          <section className="panel">
            <h2 className="sub-title">Packages</h2>
            <div className="row" style={{ marginBottom: 8 }}>
              <input
                value={queryInput}
                onInput={(event) => setQueryInput(event.currentTarget.value)}
                placeholder="Search package (contains)"
              />
              <button
                className="secondary"
                onClick={() => {
                  setQueryInput('');
                  loadPackages({
                    append: false,
                    nextQuery: ''
                  });
                }}
              >
                Clear
              </button>
            </div>
            <div className="stats-row" style={{ marginBottom: 8 }}>
              <span className="badge stat-badge stat-scope">
                <span className="badge-key">Scope</span>
                <span className="badge-value">{stats.scope}</span>
              </span>
              <span className="badge stat-badge">
                <span className="badge-key">Loaded</span>
                <span className="badge-value">{stats.loaded}</span>
              </span>
              <span className="badge stat-badge">
                <span className="badge-key">Total</span>
                <span className="badge-value">{stats.total}</span>
              </span>
              <span className="badge stat-badge">
                <span className="badge-key">Per page</span>
                <span className="badge-value">{stats.pageSize}</span>
              </span>
            </div>
            <table>
              <thead>
                <tr>
                  <th className="pkg-col">Package</th>
                  <th className="latest-col">Latest</th>
                  <th className="versions-col">Versions</th>
                  <th className="updated-col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {packages.length
                  ? packages.map((item) => (
                      <tr key={item.name}>
                        <td>
                          <button
                            className="secondary code pkg-btn"
                            title={item.name || ''}
                            onClick={() => loadPackageDetail(item.name)}
                          >
                            {item.name || ''}
                          </button>
                        </td>
                        <td className="code">{item.latest || '-'}</td>
                        <td>{item.version_count || 0}</td>
                        <td className="muted time-cell" title={item.modified || ''}>
                          {formatTime(item.modified)}
                        </td>
                      </tr>
                    ))
                  : (
                    <tr>
                      <td colSpan="4" className="muted">No package found.</td>
                    </tr>
                  )}
              </tbody>
            </table>
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="secondary"
                disabled={!cursor || listLoading}
                onClick={() => {
                  loadPackages({
                    append: true,
                    nextQuery: query
                  });
                }}
              >
                {loadMoreLabel}
              </button>
            </div>
          </section>

          <section className="panel">
            <h2 className="sub-title">Package Detail</h2>
            <div className="muted">{currentPackage ? 'Package: ' + currentPackage : 'Select one package from the list.'}</div>

            <details className="advanced-block" style={{ marginTop: 10 }}>
              <summary className="advanced-summary">Advanced actions</summary>
              <div className="advanced-sections">
                <section className="advanced-group">
                  <div className="advanced-group-head">
                    <h3 className="advanced-group-title">Dist-tag</h3>
                    <Popover.Root open={tagInfoOpen} onOpenChange={setTagInfoOpen}>
                      <div
                        className="info-wrap"
                        onMouseEnter={() => setTagInfoOpen(true)}
                        onMouseLeave={() => setTagInfoOpen(false)}
                      >
                        <Popover.Trigger asChild>
                          <button
                            type="button"
                            className="secondary info-btn"
                            aria-label="About dist-tags"
                          >
                            i
                          </button>
                        </Popover.Trigger>
                        <Popover.Portal>
                          <Popover.Content
                            className="popover-content"
                            side="top"
                            align="start"
                            sideOffset={8}
                          >
                            <div className="popover-title">Dist-tag behavior</div>
                            <ul className="popover-list">
                              <li>Alias only: map latest/next/beta/rc to an existing version.</li>
                              <li>Tag name is unique per package. Setting rc again replaces previous rc target.</li>
                            </ul>
                            <Popover.Arrow className="popover-arrow" />
                          </Popover.Content>
                        </Popover.Portal>
                      </div>
                    </Popover.Root>
                  </div>

                  <div className="row advanced-row dist-tag-row">
                    <input
                      value={tagName}
                      onInput={(event) => setTagName(event.currentTarget.value)}
                      placeholder="dist-tag (e.g. latest)"
                    />
                    <select
                      value={tagVersion}
                      onChange={(event) => setTagVersion(event.currentTarget.value)}
                    >
                      {versions.map((item) => (
                        <option key={item.version} value={item.version}>{item.version}</option>
                      ))}
                    </select>
                    <button onClick={onSetDistTag} disabled={!currentPackage || !tagVersion}>Set dist-tag</button>
                  </div>
                </section>

                <section className="advanced-group danger-group">
                  <div className="advanced-group-head">
                    <h3 className="advanced-group-title">Delete version</h3>
                  </div>

                  <div className="row advanced-row delete-row">
                    <select
                      value={deleteVersion}
                      onChange={(event) => setDeleteVersion(event.currentTarget.value)}
                    >
                      {versions.map((item) => (
                        <option key={item.version} value={item.version}>{item.version}</option>
                      ))}
                    </select>
                    <AlertDialog.Root open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                      <AlertDialog.Trigger asChild>
                        <button className="danger" disabled={!currentPackage || !deleteVersion}>Delete version</button>
                      </AlertDialog.Trigger>
                      <AlertDialog.Portal>
                        <AlertDialog.Overlay className="dialog-overlay" />
                        <AlertDialog.Content className="dialog-content">
                          <AlertDialog.Title className="dialog-title">Delete Version</AlertDialog.Title>
                          <AlertDialog.Description className="dialog-desc">
                            Delete version <span className="code">{deleteVersion || '-'}</span> from <span className="code">{currentPackage || '-'}</span>?
                            {' '}
                            This will remove both metadata and tarball object.
                          </AlertDialog.Description>
                          <div className="dialog-actions">
                            <AlertDialog.Cancel asChild>
                              <button className="secondary">Cancel</button>
                            </AlertDialog.Cancel>
                            <button className="danger" onClick={onDeleteVersion}>Delete</button>
                          </div>
                        </AlertDialog.Content>
                      </AlertDialog.Portal>
                    </AlertDialog.Root>
                  </div>
                </section>
              </div>
            </details>

            <div style={{ marginTop: 10 }}>
              <div className="json-scroll-root">
                <pre className="code json-pre">{detailJson}</pre>
              </div>
            </div>
          </section>
        </section>
      </div>

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
  );
}

const mount = document.getElementById('app');
if (mount) {
  createRoot(mount).render(<App />);
}
