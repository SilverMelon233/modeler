# 部署

镜像由 GitHub Actions 构建并推送到 GHCR，集群从 GHCR 拉取。

## 流水线

`.github/workflows/image.yml` 在 push 到 `main`（或手动触发）时运行两个 job：

1. **test** — `npm ci` → `npm test`（59 个几何/CLI 测试）→ 用 CLI 校验示例文档并要求全部水密 → `npm run build` → 断言 `dist/examples/` 存在
2. **image** — `docker/build-push-action` 构建多阶段镜像，推 `:latest` 与 `:<sha>` 双标签，层缓存走 GitHub Actions cache

镜像坐标：

```
ghcr.io/silvermelon233/modeler:latest
ghcr.io/silvermelon233/modeler:<short-sha>
```

## 手动构建

```bash
docker build -t modeler .
docker run --rm -p 8080:8080 modeler
curl -s localhost:8080/healthz   # ok
```

## 部署到 develop 命名空间

```bash
kubectl --context develop -n develop apply -f deploy/deployment.yaml -f deploy/service.yaml
kubectl --context develop -n develop rollout status deploy/modeler
```

更新镜像（CI 推了新 `:latest` 之后）：

```bash
kubectl --context develop -n develop rollout restart deploy/modeler
```

## 拉取凭据

镜像包是公开的，但显式配置 pull secret 可以让集群在包转私有后继续工作：

```bash
kubectl --context develop -n develop create secret docker-registry ghcr-modeler \
  --docker-server=ghcr.io \
  --docker-username=SilverMelon233 \
  --docker-password="$GITHUB_TOKEN"
```

> 注意：命名空间里原有的 `ghcr-pull` / `ghcr-token` 是 `Opaque` 类型（单 key `token`），
> 不能直接当 `imagePullSecrets` 用——Kubernetes 需要的是 `kubernetes.io/dockerconfigjson`。
> `ghcr-modeler` 才是正确类型。

## 访问

集群内：

```
http://modeler.develop.svc.cluster.local/
```

本地端口转发：

```bash
kubectl --context develop -n develop port-forward svc/modeler 8080:80
```

## 运行参数

| 项 | 值 | 原因 |
|---|---|---|
| 端口 | 8080 | `nginx-unprivileged` 的默认端口，配合 `runAsNonRoot` |
| UID | 101 | 同上 |
| `readOnlyRootFilesystem` | true | nginx 需要的写路径用 emptyDir 挂载 |
| 探针 | `/healthz` | nginx 直接应答，不依赖 SPA bundle |
| requests | 20m / 32Mi | 纯静态文件 |
| limits | 300m / 192Mi | 留足 gzip 与并发余量 |
