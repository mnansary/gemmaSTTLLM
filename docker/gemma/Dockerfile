FROM vllm/vllm-openai:latest

# Audio input support (libsndfile + ffmpeg + soundfile/av) — required for
# the model to ingest base64-encoded audio inside chat-completion multimodal
# payloads.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir soundfile av
