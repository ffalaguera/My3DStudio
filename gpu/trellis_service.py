"""Motor 3D propio en Modal: TRELLIS.2 (imagen → GLB) y FLUX.1 [schnell] (texto → imagen de referencia).

Solo componentes con licencia que permite uso comercial (ver replica/backend.md, "Licencias"):
  - TRELLIS.2 (código y pesos MIT) desde el fork maksonlee/TRELLIS.2 fijado a un commit, que sustituye
    RMBG-2.0 (no comercial) por BiRefNet (MIT) y nvdiffrast (no comercial) por cuBVH de CuMesh (MIT),
    y audita en cada petición que nvdiffrast/nvdiffrec no se han cargado. Si la auditoría no sale limpia, falla.
  - DINOv3 (licencia propia de Meta, permite uso comercial; repositorio con acceso restringido: hace falta HF_TOKEN).
  - FLUX.1 [schnell] (Apache 2.0).

Despliegue (una vez, desde tu equipo; ver replica/backend.md):
    pip install modal && modal token new
    modal secret create forma-trellis HF_TOKEN=hf_... SERVICE_TOKEN=<aleatorio largo>
    modal deploy gpu/trellis_service.py

API (todas con "Authorization: Bearer SERVICE_TOKEN"):
    POST   /jobs              {"kind":"model","image_b64":..., "seeds":[...], "resolution":1024, "decimation":..., "texture_size":...}
    POST   /jobs              {"kind":"image","prompt":..., "seed":...}
    GET    /jobs/{id}         → {"status": "running"|"done"|"failed", "progress": 0..1, "count": n, "error"?: str}
    GET    /jobs/{id}/file/{i} → bytes (GLB o PNG)
    DELETE /jobs/{id}         → cancela
"""
import base64
import io
import os
import secrets
import sys
import time

import modal

APP_NAME = "forma-trellis"
FORK = "https://github.com/maksonlee/TRELLIS.2.git"
FORK_SHA = "0c3378749cc4ee777c99ece7c4543e921202884f"  # 2026-11-05, revisado: tools/README.md
CUMESH_SHA = "12289e1062f0603f2f0d0771b02e1395d247f26f"
FLEXGEMM_SHA = "6dd94a859c26ee8246888502eada3dd8ad85532e"
UTILS3D_SHA = "9a4eb15e4021b67b12c460c7057d642626897ec8"  # el que fija setup.sh
FLASH_ATTN_WHL = (
    "https://github.com/Dao-AILab/flash-attention/releases/download/v2.7.3/"
    "flash_attn-2.7.3%2Bcu12torch2.6cxx11abiFALSE-cp310-cp310-linux_x86_64.whl"
)
FLUX_MODEL = "black-forest-labs/FLUX.1-schnell"
REPO = "/opt/TRELLIS.2"
GPU = os.environ.get("FORMA_GPU", "L40S")  # 48 GB: TRELLIS.2 pide ≥ 24 GB. "H100" es más rápido y más caro.
MAX_CONTAINERS = int(os.environ.get("FORMA_MAX_CONTAINERS", "2"))  # tope de gasto simultáneo

app = modal.App(APP_NAME)
cache = modal.Volume.from_name("forma-trellis-cache", create_if_missing=True)
progress = modal.Dict.from_name("forma-trellis-progress", create_if_missing=True)
secret = modal.Secret.from_name("forma-trellis")

gpu_image = (
    modal.Image.from_registry("nvidia/cuda:12.4.1-devel-ubuntu22.04", add_python="3.10")
    .apt_install("git", "build-essential", "libgl1", "libglib2.0-0", "libjpeg-dev")
    .pip_install("torch==2.6.0", "torchvision==0.21.0", index_url="https://download.pytorch.org/whl/cu124")
    .pip_install(
        "imageio", "imageio-ffmpeg", "tqdm", "easydict", "opencv-python-headless", "ninja", "trimesh",
        "transformers==4.56.2", "pandas", "zstandard", "kornia", "timm", "numpy<2.3", "huggingface_hub",
        "diffusers==0.35.1", "accelerate", "sentencepiece", "protobuf",
        f"git+https://github.com/EasternJournalist/utils3d.git@{UTILS3D_SHA}",
        FLASH_ATTN_WHL,
    )
    # Extensiones CUDA compiladas para A100 (8.0), L4/L40S (8.9) y H100 (9.0) sin necesitar GPU al construir
    .env({"TORCH_CUDA_ARCH_LIST": "8.0;8.6;8.9;9.0", "FORCE_CUDA": "1"})
    .run_commands(
        f"git clone {FORK} {REPO} && cd {REPO} && git checkout {FORK_SHA} && git submodule update --init --recursive",
        f"git clone --recursive https://github.com/JeffreyXiang/CuMesh.git /tmp/CuMesh && cd /tmp/CuMesh && git checkout {CUMESH_SHA} "
        "&& git submodule update --init --recursive && pip install . --no-build-isolation",
        f"git clone --recursive https://github.com/JeffreyXiang/FlexGEMM.git /tmp/FlexGEMM && cd /tmp/FlexGEMM && git checkout {FLEXGEMM_SHA} "
        "&& git submodule update --init --recursive && pip install . --no-build-isolation",
        f"cd {REPO} && pip install ./o-voxel --no-build-isolation",
        # nvdiffrast y nvdiffrec NO se instalan: no tienen licencia comercial.
        # Con GPU al construir: algunas extensiones se compilan sin CUDA si no ven una (solo se paga una vez).
        gpu="L4",
    )
    .run_commands(
        # comprobación: si falta CUDA en las extensiones o aparece nvdiffrast, la imagen no se construye
        "python -c \"import torch, cumesh, flex_gemm, o_voxel; assert torch.cuda.is_available()\"",
        "python -c \"import importlib.util as u; assert u.find_spec('nvdiffrast') is None and u.find_spec('nvdiffrec_render') is None\"",
        gpu="L4",
    )
    .env({
        "HF_HOME": "/cache/hf",
        "OPENCV_IO_ENABLE_OPENEXR": "1",
        "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
        "MALLOC_MMAP_THRESHOLD_": "1048576",
        "MALLOC_ARENA_MAX": "2",
    })
)

web_image = modal.Image.debian_slim(python_version="3.10").pip_install("fastapi[standard]==0.115.6")


def _set_progress(job_key: str, value: float) -> None:
    try:
        progress[job_key] = round(max(0.0, min(1.0, value)), 3)
    except Exception:  # el progreso es informativo; nunca debe tumbar una generación
        pass


@app.cls(image=gpu_image, gpu=GPU, volumes={"/cache": cache}, secrets=[secret], timeout=900,
         scaledown_window=300, max_containers=MAX_CONTAINERS)
class Trellis:
    @modal.enter()
    def load(self):
        os.chdir(REPO)
        sys.path[:0] = [os.path.join(REPO, "tools"), REPO]
        import commercial_guard  # del fork: cambia nvdiffrast por un stub que falla y bloquea nvdiffrec

        commercial_guard.install()
        self.guard = commercial_guard

        import o_voxel
        import torch
        from torchvision import transforms
        from transformers import AutoModelForImageSegmentation
        from trellis2.pipelines import Trellis2ImageTo3DPipeline as Pipeline
        from trellis2.pipelines import rembg as rembg_module
        import cubvh_raster

        birefnet_repo, birefnet_rev = "ZhengPeng7/BiRefNet", "e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4"

        class PinnedBiRefNet(rembg_module.BiRefNet):  # igual que tools/generate_commercial.py
            def __init__(self, model_name=None):
                self.model = AutoModelForImageSegmentation.from_pretrained(
                    birefnet_repo, revision=birefnet_rev, trust_remote_code=True)
                self.model.eval()
                self.transform_image = transforms.Compose([
                    transforms.Resize((1024, 1024)), transforms.ToTensor(),
                    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])

        rembg_module.BiRefNet = PinnedBiRefNet
        o_voxel.postprocess.dr = cubvh_raster

        t = time.time()
        self.pipeline = Pipeline.from_pretrained("microsoft/TRELLIS.2-4B")
        self.pipeline.low_vram = True
        self.pipeline.cuda()
        if not isinstance(self.pipeline.rembg_model, PinnedBiRefNet):
            raise RuntimeError("no se ha sustituido el quitafondos; no se continúa")
        self.o_voxel, self.torch = o_voxel, torch
        cache.commit()  # guarda los pesos descargados para el próximo arranque
        print(f"[trellis] modelos cargados en {time.time() - t:.1f} s", flush=True)

    def _audit(self):
        audit = self.guard.audit()
        if not audit.get("clean"):
            raise RuntimeError(f"auditoría de licencias no limpia: {audit}")

    @modal.method()
    def generate(self, job_key: str, image_png: bytes, seeds: list[int], resolution: int,
                 decimation: int, texture_size: int) -> list[bytes]:
        from PIL import Image

        ss = {"steps": 12, "guidance_strength": 7.5, "guidance_rescale": 0.7, "rescale_t": 5.0}
        shape = {"steps": 12, "guidance_strength": 7.5, "guidance_rescale": 0.5, "rescale_t": 3.0}
        tex = {"steps": 12, "guidance_strength": 1.0, "guidance_rescale": 0.0, "rescale_t": 3.0}
        pipeline_type = {512: "512", 1024: "1024_cascade", 1536: "1536_cascade"}[resolution]
        _set_progress(job_key, 0.05)
        with Image.open(io.BytesIO(image_png)) as im:
            im.load()
            image = self.pipeline.preprocess_image(im)
        out: list[bytes] = []
        for n, seed in enumerate(seeds):
            base = n / len(seeds)
            outputs, latents = self.pipeline.run(
                image, seed=seed, preprocess_image=False, sparse_structure_sampler_params=ss,
                shape_slat_sampler_params=shape, tex_slat_sampler_params=tex,
                pipeline_type=pipeline_type, return_latent=True)
            _set_progress(job_key, 0.1 + 0.85 * (base + 0.6 / len(seeds)))
            res = latents[2]
            mesh = outputs[0]
            asset = self.o_voxel.postprocess.to_glb(
                vertices=mesh.vertices, faces=mesh.faces, attr_volume=mesh.attrs, coords=mesh.coords,
                attr_layout=self.pipeline.pbr_attr_layout, grid_size=res,
                aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]], decimation_target=decimation,
                texture_size=texture_size, remesh=True, remesh_band=1, remesh_project=0, use_tqdm=False)
            path = f"/tmp/{job_key}-{seed}.glb"
            asset.export(path, extension_webp=False)
            with open(path, "rb") as f:
                out.append(f.read())
            os.remove(path)
            del outputs, latents, mesh, asset
            self.torch.cuda.empty_cache()
            _set_progress(job_key, 0.1 + 0.85 * ((n + 1) / len(seeds)))
        self._audit()
        return out


@app.cls(image=gpu_image, gpu=GPU, volumes={"/cache": cache}, secrets=[secret], timeout=300,
         scaledown_window=120, max_containers=1)
class Flux:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import FluxPipeline

        self.pipe = FluxPipeline.from_pretrained(FLUX_MODEL, torch_dtype=torch.bfloat16).to("cuda")
        self.torch = torch
        cache.commit()

    @modal.method()
    def image(self, job_key: str, prompt: str, seed: int) -> list[bytes]:
        _set_progress(job_key, 0.2)
        g = self.torch.Generator("cuda").manual_seed(seed)
        img = self.pipe(prompt, num_inference_steps=4, guidance_scale=0.0, height=1024, width=1024,
                        max_sequence_length=256, generator=g).images[0]
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        _set_progress(job_key, 1.0)
        return [buf.getvalue()]


@app.function(image=web_image, secrets=[secret], min_containers=0)
@modal.asgi_app()
def api():
    from fastapi import Depends, FastAPI, Header, HTTPException, Response
    from pydantic import BaseModel, Field

    web = FastAPI(title="forma-trellis", docs_url=None, redoc_url=None)
    token = os.environ["SERVICE_TOKEN"]

    def auth(authorization: str = Header(default="")):
        if not secrets.compare_digest(authorization, f"Bearer {token}"):
            raise HTTPException(401, "token no válido")

    class Job(BaseModel):
        kind: str = Field(pattern="^(model|image)$")
        image_b64: str | None = Field(default=None, max_length=30_000_000)
        prompt: str | None = Field(default=None, max_length=2000)
        seeds: list[int] = Field(default=[42], min_length=1, max_length=4)
        seed: int = 42
        resolution: int = Field(default=1024)
        decimation: int = Field(default=1_000_000, ge=500, le=2_000_000)
        texture_size: int = Field(default=2048)

    @web.post("/jobs", dependencies=[Depends(auth)])
    def create(job: Job):
        key = secrets.token_hex(8)
        if job.kind == "image":
            if not job.prompt:
                raise HTTPException(422, "falta prompt")
            call = Flux().image.spawn(key, job.prompt, job.seed)
        else:
            if not job.image_b64 or job.resolution not in (512, 1024, 1536) or job.texture_size not in (1024, 2048, 4096):
                raise HTTPException(422, "parámetros no válidos")
            call = Trellis().generate.spawn(key, base64.b64decode(job.image_b64), job.seeds, job.resolution,
                                            job.decimation, job.texture_size)
        _set_progress(key, 0.0)
        return {"id": f"{call.object_id}.{key}"}

    def lookup(job_id: str):
        try:
            call_id, key = job_id.rsplit(".", 1)
            return modal.FunctionCall.from_id(call_id), key
        except Exception:
            raise HTTPException(404, "trabajo no encontrado")

    def result(call):
        try:
            return call.get(timeout=0)
        except TimeoutError:
            return None

    @web.get("/jobs/{job_id}", dependencies=[Depends(auth)])
    def status(job_id: str):
        call, key = lookup(job_id)
        try:
            files = result(call)
        except Exception as e:  # el trabajo terminó con error
            return {"status": "failed", "error": str(e)[:500]}
        if files is None:
            return {"status": "running", "progress": progress.get(key, 0.0)}
        return {"status": "done", "progress": 1.0, "count": len(files)}

    @web.get("/jobs/{job_id}/file/{index}", dependencies=[Depends(auth)])
    def file(job_id: str, index: int):
        call, _ = lookup(job_id)
        files = result(call)
        if files is None or not 0 <= index < len(files):
            raise HTTPException(404, "archivo no disponible")
        data = files[index]
        media = "model/gltf-binary" if data[:4] == b"glTF" else "image/png"
        return Response(content=data, media_type=media)

    @web.delete("/jobs/{job_id}", dependencies=[Depends(auth)])
    def cancel(job_id: str):
        call, _ = lookup(job_id)
        call.cancel()
        return {"status": "cancelled"}

    return web
