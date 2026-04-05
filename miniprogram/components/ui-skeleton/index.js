Component({
  properties: {
    rows: {
      type: Number,
      value: 3
    },
    media: {
      type: Boolean,
      value: true
    }
  },

  data: {
    rowList: []
  },

  observers: {
    rows(value) {
      const total = Number(value || 0);
      this.setData({
        rowList: Array.from({ length: total }, (_, index) => index)
      });
    }
  },

  lifetimes: {
    attached() {
      const total = Number(this.properties.rows || 0);
      this.setData({
        rowList: Array.from({ length: total }, (_, index) => index)
      });
    }
  }
});
