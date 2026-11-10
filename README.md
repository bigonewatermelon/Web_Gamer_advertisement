# David's Game

一款用 Cocos Creator 3.8.5 制作的桥上无尽射击游戏。队伍自动前进和开火，玩家通过横移选择招募门、打爆轮胎换枪，并在 Boss 战中躲避攻击。

## 运行网页版

[直接打开游戏](https://bigonewatermelon.github.io/Web_Gamer_advertisement/)。手机上左右滑动，电脑上可用鼠标拖动、方向键或 A/D 控制队伍。

下载并解压 [Web Mobile 发布包](./Web_Gamer_advertisement-web.zip)。在解压出的目录里启动 HTTP 服务，例如运行：

```sh
python -m http.server 8000
```

在浏览器打开 [localhost:8000](http://localhost:8000/)。手机上左右滑动，电脑上可用鼠标拖动、方向键或 A/D 控制队伍。

## 编辑和构建

用 Cocos Creator 3.8.5 打开仓库根目录，运行 `assets/main.scene`。在构建面板选择 Web Mobile 即可重新导出网页版。

## 自动发布

代码推送到 `main` 后，[GitHub Actions](https://github.com/bigonewatermelon/Web_Gamer_advertisement/actions/workflows/deploy-pages.yml) 会在 GitHub 的 Windows 运行器上安装 Cocos Creator 3.8.5，从源码构建 Web Mobile 发布版，然后部署到 GitHub Pages。无需保持本机开机，也无需手动更新压缩包或 `gh-pages` 分支。

构建成功后才会更新网站；失败时保留上一次成功发布的游戏，可以在 Actions 中下载构建日志。也可以通过 Actions 页面的 **Run workflow** 手动重新发布。构建资源使用内容哈希文件名，减少浏览器读取旧资源的问题。`version.json` 记录当前线上版本对应的源码提交。

本机可运行 `./scripts/build-web.ps1` 使用相同配置构建；如果编辑器安装在其他位置，设置环境变量 `COCOS_CREATOR_PATH` 指向 `CocosCreator.exe`。输出目录为 `build/web-release`。仓库中的 ZIP 是首次发布的离线包，不会随自动部署改写。
