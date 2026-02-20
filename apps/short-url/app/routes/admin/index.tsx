// Admin index page - Links list (SPA version)
import { Link, useSearchParams } from "react-router";
import { useState, useEffect } from "react";
import {
  Button,
  TextField,
  Badge,
  Table,
  Flex,
  Text,
  IconButton,
  Tooltip,
} from "@radix-ui/themes";
import { useLinks, useTags } from "../../lib/api";

export default function AdminIndex() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get("search") || "";
  const selectedTag = searchParams.get("tag") || "";
  const [searchValue, setSearchValue] = useState(search);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const { data: linksData, loading: linksLoading, refetch: refetchLinks } = useLinks(
    search || undefined,
    selectedTag || undefined,
  );
  const { data: tagsData } = useTags();

  const links = linksData?.links || [];
  const total = linksData?.total || 0;
  const tags = tagsData?.tags || [];

  // Refetch when search params change
  useEffect(() => {
    refetchLinks();
  }, [search, selectedTag]);

  const copyToClipboard = async (code: string) => {
    try {
      const shortUrl = `${window.location.origin}/${code}`;
      await navigator.clipboard.writeText(shortUrl);
      setCopiedCode(code);
      setTimeout(() => {
        setCopiedCode((current) => (current === code ? null : current));
      }, 1200);
    } catch (err) {
      console.error("复制短链接失败:", err);
    }
  };

  const handleSearch = () => {
    const params = new URLSearchParams(searchParams);
    if (searchValue) {
      params.set("search", searchValue);
    } else {
      params.delete("search");
    }
    setSearchParams(params);
  };

  const handleTagFilter = (tag: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (tag) {
      params.set("tag", tag);
    } else {
      params.delete("tag");
    }
    setSearchParams(params);
  };

  if (linksLoading && links.length === 0) {
    return <Text color="gray">加载中...</Text>;
  }

  return (
    <div>
      {/* Search & Filter */}
      <Flex gap="3" mb="4" wrap="wrap" align="center">
        <TextField.Root
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder="搜索短链码、URL 或备注..."
          style={{ width: 280 }}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <Button onClick={handleSearch}>搜索</Button>

        {tags.length > 0 && (
          <Flex gap="2" align="center" wrap="wrap">
            <Text size="2" color="gray">标签:</Text>
            <Badge
              color={!selectedTag ? "blue" : "gray"}
              variant={!selectedTag ? "solid" : "outline"}
              onClick={() => handleTagFilter(null)}
              style={{ cursor: "pointer" }}
            >
              全部
            </Badge>
            {tags.map((tag) => (
              <Badge
                key={tag}
                color={selectedTag === tag ? "blue" : "gray"}
                variant={selectedTag === tag ? "solid" : "outline"}
                onClick={() => handleTagFilter(tag)}
                style={{ cursor: "pointer" }}
              >
                {tag}
              </Badge>
            ))}
          </Flex>
        )}
      </Flex>

      {/* Stats hint */}
      <Text size="2" color="gray" mb="3" as="p">
        共 {total} 条记录
      </Text>

      {/* Links Table */}
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>短链码</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>目标 URL</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>标签</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>更新时间</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>操作</Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {links.length === 0 ? (
            <Table.Row>
              <Table.Cell colSpan={5}>
                <Text color="gray" align="center" as="p">暂无数据</Text>
              </Table.Cell>
            </Table.Row>
          ) : (
            links.map((link) => (
              <Table.Row key={link.code}>
                <Table.Cell>
                  <Flex gap="2" align="center">
                    <code style={{ color: "var(--accent-9)" }}>{link.code}</code>
                    <Tooltip content={copiedCode === link.code ? "已复制" : "复制短链接"}>
                      <IconButton
                        size="1"
                        variant="ghost"
                        onClick={() => copyToClipboard(link.code)}
                      >
                        {copiedCode === link.code ? "✅" : "📋"}
                      </IconButton>
                    </Tooltip>
                  </Flex>
                </Table.Cell>
                <Table.Cell>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={link.url}
                    style={{ color: "inherit" }}
                  >
                    {link.url.length > 45 ? link.url.slice(0, 45) + "..." : link.url}
                  </a>
                </Table.Cell>
                <Table.Cell>
                  <Flex gap="1" wrap="wrap">
                    {link.tags?.map((tag) => (
                      <Badge key={tag} size="1" variant="soft">{tag}</Badge>
                    ))}
                  </Flex>
                </Table.Cell>
                <Table.Cell>
                  <Text size="1" color="gray">
                    {new Date(link.updatedAt).toLocaleDateString("zh-CN")}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Link to={`/${link.code}/edit`}>
                    <Button size="1" variant="ghost">编辑</Button>
                  </Link>
                </Table.Cell>
              </Table.Row>
            ))
          )}
        </Table.Body>
      </Table.Root>
    </div>
  );
}
