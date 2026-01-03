import asyncio
import re
from typing import List

import httpx

from ..config import TranslatorConfig
from .common import InvalidServerResponse
from .common_gpt import CommonGPTTranslator


class ChatMockTranslator(CommonGPTTranslator):
    _INVALID_REPEAT_COUNT = 0
    _MAX_REQUESTS_PER_MINUTE = 60
    _TIMEOUT = 40
    _RETRY_ATTEMPTS = 3
    _TIMEOUT_RETRY_ATTEMPTS = 2

    _MAX_TOKENS = 8192
    _MAX_TOKENS_IN = _MAX_TOKENS // 2

    _BASE_URL = "http://188.166.251.233:8000/v1"
    _DEFAULT_MODEL = "gpt-5.2"

    _CHAT_SYSTEM_TEMPLATE = (
        "You are a professional manga/manhwa translation engine. "
        "Translate the input text into natural English while preserving dialogue style. "
        "Keep line breaks and punctuation exactly as provided. "
        "Output only the translations with their <|number|> prefixes and no extra commentary."
    )

    def __init__(self, model: str | None = None):
        self.model = model or self._DEFAULT_MODEL
        self.MODEL = self.model
        CommonGPTTranslator.__init__(self, config_key=f"chatmock.{self.model}")
        self.client = httpx.AsyncClient(base_url=self._BASE_URL, timeout=self._TIMEOUT)
        self.config = None

    def parse_args(self, args: TranslatorConfig):
        self.config = args.chatgpt_config
        if args.chatmock_model:
            self.model = args.chatmock_model
            self.MODEL = self.model
            self._CONFIG_KEY = f"chatmock.{self.model}"

    def count_tokens(self, text: str) -> int:
        return len(text)

    async def _translate(self, from_lang: str, to_lang: str, queries: List[str]) -> List[str]:
        translations: List[str] = []
        self.logger.debug(f'Temperature: {self.temperature}, TopP: {self.top_p}')

        for prompt, query_size in self._assemble_prompts(from_lang, to_lang, queries):
            self.logger.debug('-- ChatMock Prompt --\n' + prompt)
            response = await self._request_translation(to_lang, prompt)
            self.logger.debug('-- ChatMock Response --\n' + response)
            translations.extend(self._split_translations(response, query_size))

        return translations

    def _split_translations(self, response: str, query_size: int) -> List[str]:
        parts = re.split(r'<\|\d+\|>', response)
        if parts and not parts[0].strip():
            parts = parts[1:]
        if not parts:
            parts = [response]

        parts = [part.strip() for part in parts]

        if len(parts) < query_size:
            if query_size == 1:
                return [response.strip()]
            parts.extend([''] * (query_size - len(parts)))
        elif len(parts) > query_size:
            parts = parts[:query_size]

        return parts

    async def _request_translation(self, to_lang: str, prompt: str) -> str:
        payload = self._assemble_request(to_lang, prompt)
        payload.pop("timeout", None)
        timeout_attempts = 0
        for attempt in range(self._RETRY_ATTEMPTS):
            try:
                response = await self.client.post("/chat/completions", json=payload)
                response.raise_for_status()
                data = response.json()
                content = data["choices"][0]["message"]["content"]
                if not content:
                    raise InvalidServerResponse("ChatMock returned empty content.")
                return content
            except httpx.TimeoutException as exc:
                timeout_attempts += 1
                if timeout_attempts > self._TIMEOUT_RETRY_ATTEMPTS or attempt >= self._RETRY_ATTEMPTS - 1:
                    raise InvalidServerResponse("ChatMock request timed out.") from exc
                self.logger.warning(f"ChatMock request timed out, retrying ({timeout_attempts}/{self._TIMEOUT_RETRY_ATTEMPTS}).")
                await asyncio.sleep(1 + attempt)
            except (httpx.RequestError, httpx.HTTPStatusError) as exc:
                if attempt >= self._RETRY_ATTEMPTS - 1:
                    raise InvalidServerResponse(f"ChatMock request failed: {exc}") from exc
                self.logger.warning(f"ChatMock request failed, retrying ({attempt + 1}/{self._RETRY_ATTEMPTS}).")
                await asyncio.sleep(1 + attempt)
            except (KeyError, IndexError, TypeError, ValueError) as exc:
                raise InvalidServerResponse("ChatMock returned an unexpected response format.") from exc

        raise InvalidServerResponse("ChatMock request failed after retries.")
