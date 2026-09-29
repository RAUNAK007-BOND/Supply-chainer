# Supplychainer — Hugging Face Spaces (Docker SDK) image.
# Serves the FastAPI backend and the pre-built React UI from one process on port 7860.
FROM python:3.12-slim

# Spaces run the container as UID 1000.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/home/user/.cache/huggingface \
    PUBLIC_MODE=true \
    SUPPLYCHAINER_DB=/tmp/supplychainer.db
WORKDIR $HOME/app

# CPU-only PyTorch keeps the image small (no CUDA wheels).
RUN pip install --no-cache-dir --user torch==2.11.0 --index-url https://download.pytorch.org/whl/cpu
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Bake the sentence-embedding model into the image so the first visitor doesn't wait for a download.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

COPY --chown=user backend backend
COPY --chown=user Execution Execution
COPY --chown=user frontend/dist frontend/dist

EXPOSE 7860
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
