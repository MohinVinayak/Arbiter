import asyncio
import os
import time
from dotenv import load_dotenv

load_dotenv()

async def main():
    m_key = os.getenv("MISTRAL_API_KEY")
    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=m_key, base_url="https://api.mistral.ai/v1")
    response = await client.chat.completions.create(
        model="mistral-small-latest",
        messages=[{"role": "user", "content": "Hello"}]
    )
    print("Success:", response.choices[0].message.content)

if __name__ == "__main__":
    asyncio.run(main())
