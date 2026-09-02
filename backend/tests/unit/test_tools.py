import pytest

from app.agents.tools.read_only import ListFilesTool, ReadFileTool


@pytest.mark.asyncio
async def test_read_file_tool(tmp_path):
    (tmp_path / "a.txt").write_text("hello world")
    tool = ReadFileTool(tmp_path)
    result = await tool.execute(path="a.txt")
    assert result.success
    assert result.data == "hello world"


@pytest.mark.asyncio
async def test_read_file_rejects_path_traversal(tmp_path):
    tool = ReadFileTool(tmp_path)
    result = await tool.execute(path="../../etc/passwd")
    assert not result.success


@pytest.mark.asyncio
async def test_list_files_tool(tmp_path):
    (tmp_path / "a.txt").write_text("x")
    (tmp_path / "sub").mkdir()
    tool = ListFilesTool(tmp_path)
    result = await tool.execute(path=".")
    assert result.success
    assert "a.txt" in result.data
    assert "sub/" in result.data
