// New link page (SPA version)
import { useNavigate } from "react-router";
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
} from "@radix-ui/themes";
import { apiCreateLink, useTags } from "../../lib/api";

export default function NewLink() {
  const navigate = useNavigate();
  const { data: tagsData } = useTags();
  const tags = tagsData?.tags || [];

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    const code = formData.get("code") as string | null;
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
        : undefined;

      await apiCreateLink({
        url,
        code: code || undefined,
        tags: parsedTags,
        note: note || undefined,
      });

      navigate("/");
    } catch (e: any) {
      setError(e.message || "创建失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card size="3" style={{ maxWidth: 600, margin: "0 auto" }}>
      <Heading size="5" mb="4">新建短链接</Heading>

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
              placeholder="https://example.com/very-long-path"
              size="3"
              required
            />
          </label>

          <label>
            <Text as="div" size="2" mb="1" weight="medium">
              自定义短码 <Text color="gray">(可选)</Text>
            </Text>
            <TextField.Root
              name="code"
              placeholder="留空将自动生成"
              size="3"
              style={{ fontFamily: "monospace" }}
            />
            <Text size="1" color="gray" mt="1" as="p">
              仅支持字母、数字、连字符和下划线
            </Text>
          </label>

          <label>
            <Text as="div" size="2" mb="1" weight="medium">
              标签 <Text color="gray">(逗号分隔)</Text>
            </Text>
            <TextField.Root
              id="tags"
              name="tags"
              placeholder="work, docs, important"
              size="3"
            />
            {tags.length > 0 && (
              <Flex gap="2" mt="2" wrap="wrap" align="center">
                <Text size="1" color="gray">已有标签:</Text>
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
            <Text as="div" size="2" mb="1" weight="medium">
              备注 <Text color="gray">(可选)</Text>
            </Text>
            <TextArea
              name="note"
              placeholder="描述或提醒"
              rows={3}
            />
          </label>

          <Flex gap="3" mt="2">
            <Button type="submit" size="3" style={{ flex: 1 }} disabled={isSubmitting}>
              {isSubmitting ? "创建中..." : "创建短链"}
            </Button>
            <Button asChild variant="outline" size="3">
              <a href="/_/admin">取消</a>
            </Button>
          </Flex>
        </Flex>
      </form>
    </Card>
  );
}
