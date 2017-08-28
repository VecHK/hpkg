const mz = require('mz')
const mzfs = mz.fs

class HPKGFile extends Array {

  getArrayBlockPosition(offset) {
    const {array} = this.package
    let position = 0

    for (let i = 0; i < offset; i++) {
      position += array[i].length
    }

    return position
  }
  readArrayBlock(offset) {
    const {header_option, stat} = this

    const array_pos = stat.size - header_option.tail_length - header_option.array_length
    const offset_pos = this.getArrayBlockPosition(offset)
    const {length} = this.package.array[offset]

    return this.readBlock(array_pos + offset_pos, length)
  }
  async readBlock(start, length) {
    const {fd} = this
    const buf = new Buffer(length)
    await mzfs.read(fd, buf, 0, length, start)
    return buf
  }
  async getArrayBlock(offset) {
    return {
      data_type: this.package.array[offset].data_type,
      binary: await this.readArrayBlock(offset)
    }
  }
  async get(offset) {
    if ((this[offset] === undefined) && (this.package.array[offset] === undefined)) {
      return undefined
    } else if (this[offset] instanceof Promise) {
      return await this[offset]
    } else {
      this[offset] = this.getArrayBlock(offset)
      return await this[offset]
    }
  }

  readPreviewBlock() {
    const {header_option, stat} = this
    const preview_pos = stat.size - header_option.tail_length - header_option.array_length - header_option.preview_length
    const length = this.package.preview.length
    return this.readBlock(preview_pos, length)
  }
  async getPreviewBlock() {
    return {
      data_type: this.package.preview.data_type,
      binary: await this.readPreviewBlock(),
    }
  }
  async getPreview() {
    if ((this.preview === undefined) && (this.package.preview === undefined)) {
      return undefined
    } else if (this.preview instanceof Promise) {
      return await this.preview
    } else {
      this.preview = this.getPreviewBlock()
      return await this.preview
    }
  }
  async open(path) {
    this.header_buffer = new Buffer(16 * 1024)
    const {header_buffer} = this
    this.stat = await mzfs.stat(path)
    this.fd = await mzfs.open(path, 'r')
    const {stat, fd} = this

    await mzfs.read(fd, header_buffer, 0, 16 * 1024, 0)
    const header_raw = header_buffer.toString()

    const header = header_raw.split(';')
    if (header[0] !== 'hpkg') {
      throw new Error('文件的魔数似乎不是 hpkg')
    }

    header.pop()
    header.shift()

    const header_option = {}
    header.forEach(optstr => {
      const [key, value] = optstr.split('=')
      header_option[key] = value
    })

    if (!('tail_length' in header_option)) {
      throw new Error('文件头中似乎未解析出 tail_length 属性')
    } else {
      header_option.tail_length = parseInt(header_option.tail_length)
    }

    if (!('preview_length' in header_option)) {
      console.warn('文件头中似乎未解析出 preview_length 属性')
    } else {
      header_option.preview_length = parseInt(header_option.preview_length)
    }

    this.header_option = header_option

    const tail_raw_buffer = new Buffer(header_option.tail_length)
    await mzfs.read(fd, tail_raw_buffer, 0, header_option.tail_length, stat.size - header_option.tail_length)

    this.package = JSON.parse(tail_raw_buffer.toString())
    this.package.date = new Date(this.package.date)
    return this.package
  }

  getArrayLength() {
    let total = 0
    this.forEach(media => total += media.binary.length)
    return total
  }

  async write(path) {
    const fd = await mzfs.open(path, 'w')

    const package_raw = JSON.stringify(this.package)
    const header = `hpkg;` +
      `preview_length=${this.preview.binary.length};` +
      `array_length=${this.getArrayLength()};` +
      `tail_length=${package_raw.length};`

    await mzfs.appendFile(fd, header)

    await mzfs.appendFile(fd, this.preview.binary)

    for (let i = 0; i < this.length; i++) {
      await mzfs.appendFile(fd, this[i].binary)
    }

    await mzfs.appendFile(fd, package_raw)
  }
}

class HPKG extends HPKGFile {
  setPreview({binary, data_type}) {
    this.preview = { binary, data_type }
    this.package.preview = {
      length: binary.length,
      data_type,
    }
    return this
  }
  add(opt) {
    this.push({
      binary: opt.binary,
      data_type: opt.data_type,
    })
    this.package.array.push({
      length: opt.binary.length,
      data_type: opt.data_type,
    })
    return this
  }
  init(title = 'N/A', tags = [], date = new Date) {
    this.package = {
      title, tags, date,
      array: [],
    }
  }
}


module.exports = HPKG
