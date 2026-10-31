// pages/qr/qr.js
// 二维码绑定农产品：展示批次溯源二维码，支持保存到相册打印张贴
// 二维码内容：PENGJI|<批次号>，消费者扫码后由小程序解析出批次号进行溯源
const store = require('../../utils/store.js')
const qrcode = require('../../utils/qrcode.js')

Page({
  data: {
    batchId: '',
    batch: null,
    qrContent: '',
    plotName: '',
    farmerName: ''
  },

  // 新版 Canvas 2D 节点与绘制尺寸（保存图片时必须使用节点，不能用 canvasId）
  _canvasNode: null,
  _canvasSize: 0,
  _useLegacyCanvas: false,

  onLoad(query) {
    const id = query.id || ''
    const detail = store.getBatch(id)
    if (!detail) {
      wx.showToast({ title: '批次不存在', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    this.setData({
      batchId: id,
      batch: detail.batch,
      plotName: detail.plot ? detail.plot.name : '',
      farmerName: detail.farmer ? detail.farmer.name : '',
      qrContent: 'PENGJI|' + id
    })
  },

  onReady() {
    // 节点必须在首次渲染完成后查询，真机上 onLoad 的 setData 回调里布局可能尚未就绪
    if (this.data.batch) this._draw()
  },

  _draw() {
    const query = wx.createSelectorQuery()
    query.select('#qrcanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) {
        // 老基础库回退：旧版 canvas 接口
        this._useLegacyCanvas = true
        const ctx = wx.createCanvasContext('qrcanvas', this)
        try {
          qrcode.drawToCanvas(ctx, this.data.qrContent, 240)
          ctx.draw()
        } catch (e) {
          wx.showToast({ title: '二维码绘制失败', icon: 'none' })
        }
        return
      }
      const canvas = res[0].node
      const ctx = canvas.getContext('2d')
      let dpr = 2
      try {
        dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio) || 2
      } catch (e) { dpr = 2 }
      // 真机首帧可能拿不到布局尺寸，兜底 240px（与 480rpx 画布一致）
      let size = res[0].width || 0
      if (!size || size <= 0) size = 240
      canvas.width = Math.round(size * dpr)
      canvas.height = Math.round(size * dpr)
      ctx.scale(dpr, dpr)
      this._canvasNode = canvas
      this._canvasSize = size
      try {
        qrcode.drawToCanvas(ctx, this.data.qrContent, size)
      } catch (e) {
        wx.showToast({ title: '二维码绘制失败', icon: 'none' })
      }
    })
  },

  // 保存二维码到相册（可打印贴在农产品包装上）
  save() {
    const saveToAlbum = (filePath) => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
        fail: (err) => {
          const msg = (err && err.errMsg) || ''
          if (msg.indexOf('auth') >= 0 || msg.indexOf('deny') >= 0) {
            wx.showModal({
              title: '需要相册权限',
              content: '保存二维码需要授权保存到相册，是否前往设置开启？',
              confirmText: '去设置',
              success: (r) => { if (r.confirm && wx.openSetting) wx.openSetting() }
            })
          } else {
            wx.showToast({ title: '保存失败，请重试', icon: 'none' })
          }
        }
      })
    }

    const onFail = () => wx.showToast({ title: '生成图片失败', icon: 'none' })

    if (this._canvasNode) {
      // 新版 Canvas 2D：必须传 canvas 节点，传 canvasId 在真机上会失败
      wx.canvasToTempFilePath({
        canvas: this._canvasNode,
        success: (r) => saveToAlbum(r.tempFilePath),
        fail: onFail
      })
    } else if (this._useLegacyCanvas) {
      wx.canvasToTempFilePath({
        canvasId: 'qrcanvas',
        success: (r) => saveToAlbum(r.tempFilePath),
        fail: onFail
      }, this)
    } else {
      // 节点尚未就绪：重新绘制后再保存
      this._draw()
      wx.showToast({ title: '二维码生成中，请再试一次', icon: 'none' })
    }
  },

  goTrace() {
    wx.navigateTo({ url: '/pages/product/product?id=' + this.data.batchId })
  },

  onShareAppMessage() {
    return {
      title: '棚迹溯源 · ' + (this.data.batch ? this.data.batch.productName : ''),
      path: '/pages/product/product?id=' + this.data.batchId
    }
  }
})
