import asyncio
import os
from dotenv import load_dotenv

# load environment
load_dotenv('.env')

async def main():
    # Test OpenAI compatible endpoints
    import httpx
    
    # GROQ
    groq_key = os.getenv("GROQ_API_KEY")
    if groq_key:
        print("Testing GROQ...")
        try:
            async with httpx.AsyncClient() as client:
                res = await client.get('https://api.groq.com/openai/v1/models', headers={'Authorization': f'Bearer {groq_key}'})
                data = res.json()
                print("Groq Models:", [m['id'] for m in data.get('data', [])][:5])
        except Exception as e:
            print("Groq Error:", e)

    # DEEPSEEK
    ds_key = os.getenv("DEEPSEEK_API_KEY")
    if ds_key:
        print("Testing DEEPSEEK...")
        try:
            async with httpx.AsyncClient() as client:
                res = await client.get('https://api.deepseek.com/models', headers={'Authorization': f'Bearer {ds_key}'})
                data = res.json()
                print("DeepSeek Models:", [m['id'] for m in data.get('data', [])][:5])
        except Exception as e:
            print("DeepSeek Error:", e)

    # MISTRAL
    m_key = os.getenv("MISTRAL_API_KEY")
    if m_key:
        print("Testing MISTRAL...")
        try:
            from mistralai import Mistral
            m_client = Mistral(api_key=m_key)
            # Make it sync just for test or run in executor
            res = m_client.models.list()
            print("Mistral Models:", [m.id for m in res.data][:5])
        except Exception as e:
            print("Mistral Error:", e)
            
    # GEMINI
    gem_key = os.getenv("GEMINI_API_KEY")
    if gem_key:
        print("Testing GEMINI...")
        try:
            from google import genai
            g_client = genai.Client(api_key=gem_key)
            models = g_client.models.list()
            print("Gemini Models:", [m.name for m in models][:5])
        except Exception as e:
            print("Gemini Error:", e)

if __name__ == "__main__":
    asyncio.run(main())
