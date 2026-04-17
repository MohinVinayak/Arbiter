import asyncio
import os
from dotenv import load_dotenv

load_dotenv('.env')

async def main():
    anth_key = os.getenv("ANTHROPIC_API_KEY")
    if anth_key:
        print("Testing Anthropic...")
        try:
            import anthropic
            client = anthropic.AsyncAnthropic(api_key=anth_key)
            models = await client.models.list()
            print("Anthropic Models:", [m.id for m in models.data][:5])
        except Exception as e:
            print("Anthropic Error:", e)

    openai_key = os.getenv("OPENAI_API_KEY")
    if openai_key:
        print("Testing OpenAI...")
        try:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=openai_key)
            models = await client.models.list()
            print("OpenAI Models:", [m.id for m in models.data][:5])
        except Exception as e:
            print("OpenAI Error:", e)

if __name__ == "__main__":
    asyncio.run(main())
