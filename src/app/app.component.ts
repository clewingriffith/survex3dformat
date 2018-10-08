import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';

declare var DataStream: any;

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  title = 'survex3dformat';

  private labelBuffer = '';

  constructor( private http: HttpClient) {
    //Add on a function for reading a string terminated by an arbitrary character.
    //This code is copied from datastream.js  readCString, but replacing the 
    //hardcoded '0' terminator with a value that can be passed in.
    //We use it for reading strings terminated by '\n', where we pass terminator=0x0a
    DataStream.prototype.readTerminatedString = function(terminator, length) {
        var blen = this.byteLength-this.position;
        var u8 = new Uint8Array(this._buffer, this._byteOffset + this.position);
        var len = blen;
        if (length != null) {
          len = Math.min(length, blen);
        }
        for (var i = 0; i < len && u8[i] != terminator; i++); // find first terminator byte (eg. 0 or 0x0a)
        var s = DataStream.createStringFromArray(this.mapUint8Array(i));
        if (length != null) {
          this.position += len-i;
        } else if (i != blen) {
          this.position += 1; // trailing zero if not at end of buffer
        }
        return s;
    }
  }

  ngOnInit() {  
    this.read3dFile();
  }

  private readHeader(stream) {
        const expectedHeaderStr:string = "Survex 3D Image File\n";
        const headerStr = stream.readString(expectedHeaderStr.length);
        if(headerStr !== expectedHeaderStr) {
          throw new Error('Could not find Survex 3D Image File header');
        }
        const expectedVersionString:string = "v8\n"
        const versionStr = stream.readString(expectedVersionString.length);
        if(versionStr !== expectedVersionString) {
          throw new Error('Version does not match v8. Cannot parse');
        }
        const metadata = stream.readTerminatedString(0x0a);
        console.log('Survey metatdata: ' + metadata);
        const timestampStr = stream.readTerminatedString(0x0a);
        if(timestampStr.startsWith('@')==false) {
          throw new Error('unexpected timestamp string');
        }
        //strip the @ and interpret as a timestamp
        const epochSeconds = parseInt(timestampStr.substr(1));
        const timestamp = new Date(epochSeconds*1000);
        console.log(timestamp);

        const filewideFlags = stream.readUint8();
        
        return {
          fileId: headerStr,
          version: versionStr,
          metadata: metadata,
          timestamp: timestamp,
          filewideFlags: filewideFlags          
        }
  }

  private readLabel(stream) {
    let b = stream.readUint8();
    let D;
    let A;
    if(b > 0) {
      D = b >> 4;
      A = b & 0x0f;
    } else {
      b = stream.readUint8();
      if(b != 0xff) {
        D = b;
      } else {
        D = stream.readUint32();
      }
      b = stream.readUint8();
      if(b != 0xff) {
        A = b;
      } else {
        A = stream.readUint32();
      }
    }
    const labelMod = stream.readString(A);
    if(D !== 0) {
      this.labelBuffer = this.labelBuffer.slice(0,-D);
    }
    this.labelBuffer=this.labelBuffer+labelMod;
    return this.labelBuffer;
  }


  private readLRUDInt16(stream): number {
    const val = stream.readInt16(); 
    if(val == 0xffff) { 
      return null; 
    } else { 
      return 0.01*parseInt(val);
    }
  }

  private readLRUDInt32(stream): number {
    const val = stream.readInt32(); 
    if(val == 0xffffffff) { 
      return null; 
    } else { 
      return 0.01*parseInt(val);
    }
  }



  // copied from the survex codebase
  private is_leap_year(year: number): boolean
  {
    return (year % 4 == 0 && (year % 100 != 0 || year % 400 == 0));
  } 

  // copied from the survex codebase
  private ymd_from_days_since_1900(days: number)
  {
    let g, dg, c, dc, b, db, a, da, y, m;
    days += 693901;
    g = Math.trunc(days / 146097);
    dg = days % 146097;
    c = Math.trunc((Math.trunc(dg / 36524) + 1) * 3 / 4);
    dc = dg - c * 36524;
    b = Math.trunc(dc / 1461);
    db = dc % 1461;
    a = Math.trunc((Math.trunc(db / 365) + 1) * 3 / 4);
    da = db - a * 365;
    y = g * 400 + c * 100 + b * 4 + a;
    m = Math.trunc((da * 5 + 308) / 153);
    return [ 
      y + Math.trunc(m / 12),
      m % 12 + 1,
      da - Math.trunc((m + 2) * 153 / 5) + 123
    ];
  }

  private date_from_days_since_1900(days: number): Date {
    const ymd = this.ymd_from_days_since_1900(days);
    return new Date(ymd[0], ymd[1]-1, ymd[2]);
  }

  private readItem(stream) {
    const code = stream.readUint8();
    let item = { };
    
    if(code == 0x00) {
        item['codetype'] = 'STOP';
    } else if (code == 0x01) {
        item['codetype'] = 'STYLE_DIVING';
    } else if (code == 0x02) {
        item['codetype'] = 'STYLE_CARTESIAN';
    } else if (code == 0x03) {
        item['codetype'] = 'STYLE_CYLPOLAR';
    } else if (code == 0x04) {
        item['codetype'] = 'STYLE_NOSURVEY';
    } else if (code == 0x0f) {
      item['codetype'] = 'MOVE';
      item['x'] = 0.01*parseInt(stream.readInt32());
      item['y'] = 0.01*parseInt(stream.readInt32());
      item['z'] = 0.01*parseInt(stream.readInt32());
    } else if (code == 0x10) {
      item['codetype'] = 'DATE';
    } else if (code == 0x11) {
      item['codetype'] = 'DATE';
      const daysSince1900 = stream.readUint16();
      item['date']=this.date_from_days_since_1900(daysSince1900);
    } else if (code == 0x12) {
      item['codetype'] = 'DATE';
      const daysSince1900 = stream.readUint16();
      const dayspan = stream.readUint8();
      const daysSince1900_2 = daysSince1900 + dayspan;
      const date1 = this.date_from_days_since_1900(daysSince1900);
      const date2 = this.date_from_days_since_1900(daysSince1900_2);
      item['date'] = date1;
      item['dates']=[date1, date2];
    } else if (code == 0x13) {
      item['codetype'] = 'DATE';
      const daysSince1900 = stream.readUint16();
      const daysSince1900_2 = stream.readUint16();
      const date1 = this.date_from_days_since_1900(daysSince1900);
      const date2 = this.date_from_days_since_1900(daysSince1900_2);
      item['date'] = date1;
      item['dates']=[date1, date2];
    } else if (code == 0x1f) {
        item['codetype'] = 'ERROR';
        const legs = stream.readInt32();
        const length = 0.01*parseInt(stream.readInt32());
        const e = 0.01*parseInt(stream.readInt32());
        const h = 0.01*parseInt(stream.readInt32());
        const v = 0.01*parseInt(stream.readInt32());
        item['error'] = { legs: legs, length: length, e:e, h:h, v:v };
    } else if(code >= 0x30 && code <= 0x31) {
      item['codetype'] = 'XSECT';
      item['label'] = this.readLabel(stream);
      item['l'] = this.readLRUDInt16(stream);
      item['r'] = this.readLRUDInt16(stream);
      item['u'] = this.readLRUDInt16(stream);
      item['d'] = this.readLRUDInt16(stream);
      const flag = (code & 0x01);
      if(flag & 0x01) {
        item['flag'] = 'LAST_IN_PASSAGE';
      }
    } else if(code >= 0x32 && code <= 0x33) {
      item['codetype'] = 'XSECT';
      item['label'] = this.readLabel(stream);
      item['l'] = this.readLRUDInt32(stream);
      item['r'] = this.readLRUDInt32(stream);
      item['u'] = this.readLRUDInt32(stream);
      item['d'] = this.readLRUDInt32(stream);
      const flag = (code & 0x01);
      if(flag & 0x01) {
        item['flag'] = 'LAST_IN_PASSAGE';
      }
    } else if(code >= 0x40 && code <= 0x7f) {
      item['codetype'] = 'LINE';

      const flag = (code & 0x3f);
      if(flag) {
        item['flags']=[];
      }
      if(flag & 0x01) {
        item['flags'].push('ABOVE_GROUND');
      } 
      if (flag & 0x02) {
        item['flags'].push('DUPLICATE');
      }
      if (flag & 0x04) {
        item['flags'].push('SPLAY');
      } 

      if(flag & 0x20) {
        // omit label
      } else {
        item['label'] = this.readLabel(stream);
      }
        item['x'] = 0.01*parseInt(stream.readInt32());
        item['y'] = 0.01*parseInt(stream.readInt32());
        item['z'] = 0.01*parseInt(stream.readInt32());

    } else if(code >= 0x80 && code <=0xff) {
        item['codetype'] = 'LABEL';
        item['label'] = this.readLabel(stream);
        item['x'] = 0.01*parseInt(stream.readInt32());
        item['y'] = 0.01*parseInt(stream.readInt32());
        item['z'] = 0.01*parseInt(stream.readInt32());

        const flag = (code & 0x7f);
        if(flag) {
          item['flags'] = []
        }
        if(flag & 0x01) {
          item['flags'].push('ABOVE_GROUND');
        }
        if (flag & 0x02) {
          item['flags'].push('UNDERGROUND');
        }
        if (flag & 0x04) {
          item['flags'].push('ENTRANCE');
        }
        if (flag & 0x08) {
          item['flags'].push('EXPORT');
        }
        if (flag & 0x10) {
          item['flags'].push('FIXED');
        }
        if (flag & 0x20) {
          item['flags'].push('ANONYMOUS');
        }
        if (flag & 0x40) {
          item['flags'].push('PASSAGE_WALL');
        } 

    } else {
      // console.log('unknown code' + code);
    }
    return item;
    
  }

  private read3dFile() {
    //This attempts to parse survex 3d image files as specified at 
    //https://survex.com/docs/3dformat.htm
    //It currently only handles version 8
    this.http.get('assets/mig.3d', {responseType: 'arraybuffer'}).subscribe( data => {
        var stream = new DataStream(data, 0,
          DataStream.LITTLE_ENDIAN);

        const header = this.readHeader(stream);
        console.log(header);

        let items = [];
        while(stream.isEof() == false) {
          const item = this.readItem(stream);
          items.push(item); // console.log(item);
        }

        console.log(items);

      }
    );
 
    const reader = new FileReader();
    
  }

}
