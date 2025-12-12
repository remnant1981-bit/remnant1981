try:
    import google.generativeai as genai
    print("GenAI Import OK")
except ImportError as e:
    print(f"GenAI Import FAILED: {e}")

try:
    from flask import Flask
    print("Flask Import OK")
except ImportError as e:
    print(f"Flask Import FAILED: {e}")
