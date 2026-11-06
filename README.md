# Web_Gamer_advertisement

一款用 Cocos Creator 3.8.5 制作的桥上无尽射击游戏。队伍自动前进和开火，玩家通过横移选择招募门、打爆轮胎换枪，并在 Boss 战中躲避攻击。

## 运行网页版

下载并解压 [Web Mobile 发布包](./Web_Gamer_advertisement-web.zip)。在解压出的目录里启动 HTTP 服务，例如运行：

```sh
python -m http.server 8000
```

在浏览器打开 [localhost:8000](http://localhost:8000/)。手机上左右滑动，电脑上可用鼠标拖动、方向键或 A/D 控制队伍。

## 编辑和构建

用 Cocos Creator 3.8.5 打开仓库根目录，运行 `assets/main.scene`。在构建面板选择 Web Mobile 即可重新导出网页版。
