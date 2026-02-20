// Edit link page (SPA version)
import { useNavigate, useParams } from "react-router";
import { useState } from "react";
import {
  Button,
  TextField,
  TextArea,
  Badge,
  Flex,
  Text,
  Card,
  Callout,
  Heading,
  Separator,
  AlertDialog,
  Box,
} from "@radix-ui/themes";
import { useLink, useTags, apiUpdateLink, apiDeleteLink } from "../../lib/api";

export default function EditLink() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const { data: link, loading, error: loadError } = useLink(code!);
  const { data: tagsData } = useTags();
  const tags = tagsData?.tags || [];

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const shortUrl = link ? `${window.location.origin}/${link.code}` : "";

  const addTag = (tag: string) => {
    const input = document.getElementById("tags") as HTMLInputElement;
    const current = input.value ? input.value.split(",").map((t) => t.trim()) : [];
    if (!current.includes(tag)) {
      input.value = [...current, tag].join(", ");
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const formData = new FormData(e.currentTarget);
    const url = formData.get("url") as string;
    const newCode = formData.get("code") as string | null;
    const tagsStr = formData.get("tags") as string | null;
    const note = formData.get("note") as string | null;

    if (!url) {
      setError("URL 不能为空");
      setIsSubmitting(false);
      return;
    }

    try {
      const parsedTags = tagsStr
        ? tagsStr.split(",").map((t) => t.trim()).filter(Boolean)
        : [];

      await apiUpdateLink(code!, {
        url,
        code: newCode || undefined,
        tags: parsedTags,
        note: note || undefined,
      });

      navigate("/");
    } catch (e: any) {
      setError(e.message || "更新失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    try {
      await apiDeleteLink(code!);
      navigate("/");
    } catch (e: any) {
      setError(e.message || "删除失败");
    }
  };

  if (loading) {
    return <Text color="gray">加载中...</Text>;
  }

  if (loadError || !link) {
    return (
      <Callout.Root color="red">
        <Callout.Text>{loadError || "链接不存在"}</Callout.Text>
      </Callout.Root>
    );
  }

  return (
    <Card size="3" style={{ maxWidth: 600, margin: "0 auto" }}>
      <Heading size="5" mb="4">编辑短链接</Heading>

      {/* Stats card */}
      <Box mb="4" p="3" style={{ background: "var(--gray-2)", borderRadius: "var(--radius-2)" }}>
        <Flex gap="4" wrap="wrap">
          <div>
            <Text size="1" color="gray" as="p">短链接</Text>
            <a href={shortUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-9)" }}>
              {shortUrl}
            </a>
          </div>
          <div>
            <Text size="1" color="gray" as="p">创建时间</Text>
            <Text size="2">{new Date(link.createdAt).toLocaleString("zh-CN")}</Text>
          </div>
        </Flex>
      </Box>

      {error && (
        <Callout.Root color="red" mb="4">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}

      <form onSubmit={handleSubmit}>
        <Flex direction="column" gap="4">
          <label>
            <Text as="div" size="2" mb="1" weight="medium">
              目标 URL <Text color="red">*</Text>
            </Text>
            <TextField.Root
              type="url"
              name="url"
              defaultValue={link.url}
              size="3"
              required
            />
          </label>

          <label>
            <Text as="div" size="2" mb="1" weight="medium">短链码</Text>
            <TextField.Root
              name="code"
              defaultValue={link.code}
              size="3"
              style={{ fontFamily: "monospace" }}
            />
            <Text size="1" color="red" mt="1" as="p">
              警告: 修改短链码会导致原链接失效
            </Text>
          </label>

          <label>
            <Text as="div" size="2" mb="1" weight="medium">
              标签 <Text color="gray">(逗号分隔)</Text>
            </Text>
            <TextField.Root
              id="tags"
              name="tags"
              defaultValue={link.tags?.join(", ") || ""}
              size="3"
            />
            {tags.length > 0 && (
              <Flex gap="2" mt="2" wrap="wrap" align="center">
                <Text size="1" color="gray">可用标签:</Text>
                {tags.map((tag) => (
                  <Badge
                    key={tag}
                    onClick={() => addTag(tag)}
                    style={{ cursor: "pointer" }}
                    variant="soft"
                  >
                    {tag}
                  </Badge>
                ))}
              </Flex>
            )}
          </label>

          <label>
            <Text as="div" size="2" mb="1" weight="medium">备注</Text>
            <TextArea
              name="note"
              defaultValue={link.note || ""}
              rows={3}
            />
          </label>

          <Flex gap="3" mt="2">
            <Button type="submit" size="3" style={{ flex: 1 }} disabled={isSubmitting}>
              {isSubmitting ? "保存中..." : "保存修改"}
            </Button>
            <Button asChild variant="outline" size="3">
              <a href="/_/admin">取消</a>
            </Button>
          </Flex>
        </Flex>
      </form>

      <Separator my="4" size="4" />

      {/* Danger zone */}
      <Box>
        <Heading size="3" mb="2" color="red">危险操作</Heading>
        <AlertDialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialog.Trigger>
            <Button color="red" variant="outline">删除短链接</Button>
          </AlertDialog.Trigger>
          <AlertDialog.Content>
            <AlertDialog.Title>确认删除</AlertDialog.Title>
            <AlertDialog.Description>
              确定要删除这个短链接吗？此操作不可撤销。
            </AlertDialog.Description>
            <Flex gap="3" mt="4" justify="end">
              <AlertDialog.Cancel>
                <Button variant="soft" color="gray">取消</Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action>
                <Button color="red" onClick={handleDelete}>确认删除</Button>
              </AlertDialog.Action>
            </Flex>
          </AlertDialog.Content>
        </AlertDialog.Root>
      </Box>
    </Card>
  );
}
