// Admin layout - auth is handled by Hono middleware (Basic Auth)
import { Outlet, Link } from "react-router";
import { Button, Flex } from "@radix-ui/themes";
import { usePluginAdminEntries } from "../../lib/api";

export default function AdminLayout() {
  const { data: entryData } = usePluginAdminEntries();
  const pluginEntries = (entryData?.entries || []).filter((entry) => entry.path !== "/" && entry.path !== "/new");

  return (
    <div className="admin-layout">
      {/* Header */}
      <header className="admin-header">
        <Link to="/" className="admin-logo">
          🔗 Short URL 管理
        </Link>
        <Flex gap="3" align="center">
          <Button variant="ghost" asChild>
            <Link to="/">链接列表</Link>
          </Button>
          {pluginEntries.map((entry) => (
            <Button key={entry.id} variant="ghost" asChild>
              <Link to={entry.path} title={entry.description || entry.label}>
                {entry.label}
              </Link>
            </Button>
          ))}
          <Button asChild>
            <Link to="/new">+ 新建短链</Link>
          </Button>
        </Flex>
      </header>

      {/* Main content */}
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
