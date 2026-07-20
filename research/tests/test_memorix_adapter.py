import json
from pathlib import Path

from memorixbench.memorix_adapter import (
    PROVIDER_ENV_KEYS,
    _isolated_process_env,
    _parse_mcp_body,
    write_claude_mcp_config,
)


def test_parses_sse_mcp_response() -> None:
    body = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n'
    assert _parse_mcp_body(body)["result"] == {"ok": True}


def test_writes_isolated_claude_mcp_config(tmp_path: Path) -> None:
    path = write_claude_mcp_config(
        path=tmp_path / "mcp.json",
        cli_path=Path("C:/memorix/dist/cli/index.js"),
        workspace=Path("C:/case"),
        data_dir=Path("C:/data"),
        home_dir=Path("C:/home"),
        mode="micro",
    )
    payload = json.loads(path.read_text(encoding="utf-8"))
    server = payload["mcpServers"]["memorix"]
    assert server["args"][-1] == "micro"
    assert server["env"]["MEMORIX_EMBEDDING"] == "off"
    assert server["env"]["OPENROUTER_API_KEY"] == ""


def test_isolated_process_env_scrubs_provider_credentials(monkeypatch) -> None:
    for key in PROVIDER_ENV_KEYS:
        monkeypatch.setenv(key, "do-not-inherit")

    isolated = _isolated_process_env({"MEMORIX_LLM_MODEL": "controlled-model"})

    assert isolated["MEMORIX_LLM_MODEL"] == "controlled-model"
    assert "OPENROUTER_API_KEY" not in isolated
    assert "OPENAI_API_KEY" not in isolated
