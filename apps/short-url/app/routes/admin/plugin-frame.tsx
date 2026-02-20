import { useMemo } from "react";
import { useParams } from "react-router";
import { Callout, Card, Heading, Text } from "@radix-ui/themes";
import { usePluginAdminEntries } from "../../lib/api";

export default function PluginFramePage() {
  const { pluginId } = useParams<{ pluginId: string }>();
  const { data, loading, error } = usePluginAdminEntries();

  const entry = useMemo(() => {
    const entries = data?.entries || [];
    return entries.find((item) => item.id === pluginId) || null;
  }, [data?.entries, pluginId]);

  if (loading) {
    return <Text color="gray">插件页面加载中...</Text>;
  }

  if (error) {
    return (
      <Callout.Root color="amber">
        <Callout.Text>插件入口加载失败: {error}</Callout.Text>
      </Callout.Root>
    );
  }

  if (!entry) {
    return (
      <Callout.Root color="amber">
        <Callout.Text>插件页面不存在或当前环境不可用。</Callout.Text>
      </Callout.Root>
    );
  }

  if (!entry.iframePath) {
    return (
      <Card size="3">
        <Heading size="4" mb="2">{entry.label}</Heading>
        <Text color="gray">当前插件未提供页面渲染地址。</Text>
      </Card>
    );
  }

  return (
    <div style={{ height: "calc(100vh - 120px)" }}>
      <iframe
        title={entry.label}
        src={entry.iframePath}
        style={{
          width: "100%",
          height: "100%",
          border: "1px solid var(--gray-5)",
          borderRadius: "10px",
          background: "white",
        }}
      />
    </div>
  );
}
